import { describe, expect, it, spyOn } from "bun:test";
import type { TelegramInlineQueryResult } from "@gramio/types";
import { Bot, InlineKeyboard, TelegramError } from "gramio";
import {
	apiError,
	MessageObject,
	TelegramTestEnvironment,
} from "../src/index.ts";

function setup() {
	const bot = new Bot("test");
	const env = new TelegramTestEnvironment(bot);
	const user = env.createUser();
	return { bot, env, user };
}

describe("inline entity lifecycle", () => {
	const results: TelegramInlineQueryResult[] = [
		{
			type: "photo",
			id: "photo-url",
			photo_url: "https://example.test/photo.jpg",
			thumbnail_url: "https://example.test/thumb.jpg",
			photo_width: 640,
			photo_height: 480,
		},
		{ type: "video", id: "video", title: "Video", video_file_id: "video" },
		{
			type: "document",
			id: "document",
			title: "Document",
			document_file_id: "document",
		},
		{ type: "audio", id: "audio", audio_file_id: "audio" },
		{ type: "voice", id: "voice", title: "Voice", voice_file_id: "voice" },
		{ type: "gif", id: "gif", gif_file_id: "gif" },
		{ type: "mpeg4_gif", id: "mpeg4", mpeg4_file_id: "mpeg4" },
		{ type: "sticker", id: "sticker", sticker_file_id: "sticker" },
		{
			type: "location",
			id: "location",
			title: "Location",
			latitude: 12,
			longitude: 34,
			live_period: 60,
		},
		{
			type: "venue",
			id: "venue",
			title: "Venue",
			address: "Street",
			latitude: 12,
			longitude: 34,
		},
		{
			type: "contact",
			id: "contact",
			first_name: "Alice",
			last_name: "Smith",
			phone_number: "+123",
		},
	];
	for (const result of results) {
		it(`materializes ${result.id} without extra bot updates`, async () => {
			const { bot, env, user } = setup();
			bot.inlineQuery("find", (ctx) => ctx.answer([result]));
			const query = await user.sendInlineQuery("find");
			env.clearApiCalls();
			const bubble = await user.sendInlineResult(result.id, query);
			const kind =
				result.type === "gif" || result.type === "mpeg4_gif"
					? "animation"
					: result.type;
			expect(Reflect.get(bubble.payload, kind)).toBeDefined();
			expect(env.updates).toHaveLength(2);
			if (result.id === "photo-url")
				expect(bubble.payload.photo?.[0]).toMatchObject({
					width: 640,
					height: 480,
				});
			if (result.id === "mpeg4")
				expect(bubble.payload.animation?.file_id).toBe("mpeg4");
		});
	}

	it("edits and stops an inline live location", async () => {
		const { bot, env, user } = setup();
		bot.inlineQuery("location", (ctx) =>
			ctx.answer([
				{
					type: "location",
					id: "loc",
					latitude: 1,
					longitude: 2,
					live_period: 60,
					title: "Live",
					reply_markup: new InlineKeyboard().text("Stop", "stop"),
				},
			]),
		);
		const bubble = await user.sendInlineResult(
			"loc",
			await user.sendInlineQuery("location"),
		);
		await bot.api.editMessageLiveLocation({
			inline_message_id: bubble.inlineMessageId,
			latitude: 3,
			longitude: 4,
		});
		expect(bubble.payload.location).toMatchObject({
			latitude: 3,
			longitude: 4,
			live_period: 60,
		});
		expect(env.lastApiCall("editMessageLiveLocation")?.response).toBe(true);
		await bot.api.stopMessageLiveLocation({
			inline_message_id: bubble.inlineMessageId,
		});
		expect(bubble.payload.location?.live_period).toBeUndefined();
		await expect(
			bot.api.stopMessageLiveLocation({ inline_message_id: "missing" }),
		).rejects.toThrow("not active");
	});
	it("replays audio placeholder → chosen result → media replacement → inline callback", async () => {
		const { bot, env, user } = setup();
		let receivedMessages = 0;
		bot.on("message", () => {
			receivedMessages++;
		});
		bot.inlineQuery("track", (ctx) =>
			ctx.answer([
				{
					type: "audio",
					id: "track",
					audio_url: "https://example.test/silence.mp3",
					title: "Loading",
					reply_markup: new InlineKeyboard().text("Refresh", "refresh"),
				},
			]),
		);
		bot.chosenInlineResult("track", async (ctx) => {
			if (!ctx.inlineMessageId) throw new Error("Missing inline ID");
			await bot.api.editMessageMedia({
				inline_message_id: ctx.inlineMessageId,
				media: {
					type: "audio",
					media: "cached_track",
					title: "Real track",
					performer: "Artist",
					duration: 123,
				},
				reply_markup: new InlineKeyboard().text("Refresh", "refresh"),
			});
		});
		bot.callbackQuery("refresh", async (ctx) => {
			expect(ctx.inlineMessageId).toBeDefined();
			expect(ctx.payload.message).toBeUndefined();
			await bot.api.editMessageCaption({
				inline_message_id: ctx.inlineMessageId,
				caption: "Refreshed",
			});
			await ctx.answer();
		});
		const query = await user.sendInlineQuery("track");
		const bubble = await user.sendInlineResult("track", query);
		expect(bubble.payload.audio).toMatchObject({
			file_id: "cached_track",
			title: "Real track",
			performer: "Artist",
			duration: 123,
		});
		expect(env.inlineMessage(bubble.inlineMessageId ?? "")).toBe(bubble);
		await user.on(bubble).clickByText("Refresh");
		expect(bubble.payload.caption).toBe("Refreshed");
		expect(env.lastApiCall("editMessageMedia")?.response).toBe(true);
		expect(receivedMessages).toBe(0);
		expect(env.updates.map((update) => Object.keys(update)[1])).toEqual([
			"inline_query",
			"chosen_inline_result",
			"callback_query",
		]);
		expect(env.updates[1].chosen_inline_result?.inline_message_id).toBe(
			bubble.inlineMessageId,
		);
	});

	it("does not invent inline IDs for results without keyboards", async () => {
		const { bot, env, user } = setup();
		bot.inlineQuery("plain", (ctx) =>
			ctx.answer([
				{
					type: "article",
					id: "a",
					title: "A",
					input_message_content: { message_text: "hello" },
				},
			]),
		);
		const bubble = await user.sendInlineResult(
			"a",
			await user.sendInlineQuery("plain"),
		);
		expect(bubble.inlineMessageId).toBeUndefined();
		expect(
			env.updates[1].chosen_inline_result?.inline_message_id,
		).toBeUndefined();
		expect(bubble.payload.text).toBe("hello");
	});

	it("replaces an article with cached photo and keeps each selection independent", async () => {
		const { bot, env, user } = setup();
		bot.inlineQuery("a", (ctx) =>
			ctx.answer([
				{
					type: "article",
					id: "a",
					title: "A",
					input_message_content: { message_text: "hello" },
					reply_markup: new InlineKeyboard().text("Go", "go"),
				},
			]),
		);
		const query = await user.sendInlineQuery("a");
		const first = await user.sendInlineResult("a", query);
		const second = await user.sendInlineResult("a", query);
		await bot.api.editMessageMedia({
			inline_message_id: first.inlineMessageId,
			media: { type: "photo", media: "photo", caption: "Photo" },
		});
		expect(first.payload.text).toBeUndefined();
		expect(first.payload.photo?.[0].file_id).toBe("photo");
		expect(second.payload.text).toBe("hello");
		expect(first.inlineMessageId).not.toBe(second.inlineMessageId);
		expect(env.updates[1].chosen_inline_result).not.toHaveProperty("message");
	});

	it("rejects unknown inline IDs and new inline uploads without mutation", async () => {
		const { bot, env, user } = setup();
		await expect(
			bot.api.editMessageText({ inline_message_id: "missing", text: "x" }),
		).rejects.toBeInstanceOf(TelegramError);
		bot.inlineQuery("p", (ctx) =>
			ctx.answer([
				{
					type: "photo",
					id: "p",
					photo_file_id: "photo",
					reply_markup: new InlineKeyboard().text("Go", "go"),
				},
			]),
		);
		const bubble = await user.sendInlineResult(
			"p",
			await user.sendInlineQuery("p"),
		);
		// Promised uploads are accepted at runtime, but not by the current Bot API declarations.
		await expect(
			bot.api.editMessageMedia({
				inline_message_id: bubble.inlineMessageId,
				media: {
					type: "photo",
					// @ts-expect-error Runtime compatibility regression for promised uploads.
					media: Promise.resolve(new File(["new"], "p.jpg")),
				},
			}),
		).rejects.toThrow("cannot upload");
		expect(bubble.payload.photo?.[0].file_id).toBe("photo");
		env.onApi("editMessageCaption", apiError(400, "failed"));
		await expect(
			bot.api.editMessageCaption({
				inline_message_id: bubble.inlineMessageId,
				caption: "bad",
			}),
		).rejects.toThrow("failed");
		expect(bubble.payload.caption).toBeUndefined();
	});

	it("does not materialize an unsuccessful inline answer", async () => {
		const { bot, env, user } = setup();
		env.onApi("answerInlineQuery", apiError(400, "invalid"));
		bot.inlineQuery("x", (ctx) =>
			bot.api.answerInlineQuery({
				inline_query_id: ctx.id,
				results: [
					{
						type: "article",
						id: "x",
						title: "X",
						input_message_content: { message_text: "x" },
					},
				],
				suppress: true,
			}),
		);
		const query = await user.sendInlineQuery("x");
		await expect(user.sendInlineResult("x", query)).rejects.toThrow(
			"No successful inline answer",
		);
		expect(user.asChat.messages).toHaveLength(0);
	});
});

describe("file registry and uploads", () => {
	it("preserves metadata, stable identity, bytes, and thumbnails across cached reuse", async () => {
		const { bot, env, user } = setup();
		const upload = new File(["music"], "track.mp3", { type: "audio/mpeg" });
		const audio = await bot.api.sendAudio({
			chat_id: user.payload.id,
			// @ts-expect-error Runtime compatibility regression for promised uploads.
			audio: Promise.resolve(upload),
			title: "Title",
			performer: "Artist",
			duration: 123,
			// @ts-expect-error Runtime compatibility regression for promised uploads.
			thumbnail: Promise.resolve(new File(["thumb"], "cover.jpg")),
		});
		expect(audio.audio).toMatchObject({
			title: "Title",
			performer: "Artist",
			duration: 123,
			file_name: "track.mp3",
			file_size: 5,
			mime_type: "audio/mpeg",
		});
		expect(audio.audio?.thumbnail).toMatchObject({
			width: 90,
			height: 90,
			file_size: 5,
		});
		const id = audio.audio?.file_id ?? "";
		const reused = await bot.api.sendAudio({
			chat_id: user.payload.id,
			audio: id,
		});
		expect(reused.audio).toEqual(audio.audio);
		const uploadedAgain = await bot.api.sendAudio({
			chat_id: user.payload.id,
			audio: upload,
		});
		expect(uploadedAgain.audio?.file_id).toBe(id);
		expect(await bot.api.getFile({ file_id: id })).toMatchObject({
			file_id: id,
			file_unique_id: audio.audio?.file_unique_id,
			file_size: 5,
		});
		expect(await bot.downloadFile(id).text()).toBe("music");
		expect(new TextDecoder().decode(await bot.downloadFile(id))).toBe("music");
		expect(env.lastApiCall("sendAudio")?.params.audio).toBeInstanceOf(Blob);
	});

	it("supports promised album uploads and promised edit media", async () => {
		const { bot, user } = setup();
		const album = await bot.api.sendMediaGroup({
			chat_id: user.payload.id,
			media: [
				{
					type: "audio",
					// @ts-expect-error Runtime compatibility regression for promised uploads.
					media: Promise.resolve(new File(["1"], "one.mp3")),
					title: "One",
					duration: 11,
				},
				{
					type: "audio",
					// @ts-expect-error Runtime compatibility regression for promised uploads.
					media: Promise.resolve(new File(["2"], "two.mp3")),
					title: "Two",
					performer: "Two artist",
				},
			],
		});
		expect(album[0].audio).toMatchObject({ title: "One", duration: 11 });
		expect(album[1].audio).toMatchObject({
			title: "Two",
			performer: "Two artist",
		});
		await bot.api.editMessageMedia({
			chat_id: user.payload.id,
			message_id: album[0].message_id,
			media: {
				type: "audio",
				// @ts-expect-error Runtime compatibility regression for promised uploads.
				media: Promise.resolve(new File(["3"], "three.mp3")),
				title: "Three",
			},
		});
	});

	it("downloads an incoming fixture through the real context download helper", async () => {
		const { bot, env, user } = setup();
		const file = env.registerFile(new File(["document bytes"], "fixture.txt"));
		let downloaded = "";
		bot.on("message", async (ctx) => {
			downloaded = new TextDecoder().decode(await ctx.download());
		});
		await user.send(new MessageObject().document(file));
		expect(downloaded).toBe("document bytes");
		expect(
			(await bot.api.getFile({ file_id: file.file_id })).file_unique_id,
		).toBe(file.file_unique_id);
	});

	it("never downloads unknown fixture content from the network", async () => {
		const { bot, user } = setup();
		const message = await user.sendAudio();
		await expect(
			bot.downloadFile(message.payload.audio?.file_id ?? "").text(),
		).rejects.toThrow("No bytes registered");
		await expect(bot.api.getFile({ file_id: "missing" })).rejects.toThrow(
			"file not found",
		);
	});

	it("isolates registries and restores the download configuration on dispose", async () => {
		const { bot, env } = setup();
		const second = setup();
		const file = env.registerFile(new Blob(["first"]));
		expect(second.env.file(file.file_id)).toBeUndefined();
		env.dispose();
		expect(bot.options.files).toBeUndefined();
		const next = new TelegramTestEnvironment(bot);
		expect(next.file(file.file_id)).toBeUndefined();
		next.dispose();
	});
});

describe("guest and prepared messages", () => {
	it("answers a guest audio with an editable inline placeholder", async () => {
		const { bot, env, user } = setup();
		let inlineId = "";
		bot.on("guest_message", async (ctx) => {
			const response = await bot.api.answerGuestQuery({
				guest_query_id: ctx.guestQueryId ?? "",
				result: {
					type: "article",
					id: "loading",
					title: "Loading",
					input_message_content: { message_text: "Loading" },
					reply_markup: new InlineKeyboard().text("Cancel", "cancel"),
				},
			});
			inlineId = response.inline_message_id;
			await bot.api.editMessageMedia({
				inline_message_id: inlineId,
				media: { type: "audio", media: "found-track", title: "Found track" },
			});
		});
		const guest = await user.sendGuestMessage(new MessageObject().audio());
		const bubble = env.inlineMessage(inlineId);
		expect(bubble?.payload.audio?.file_id).toBe("found-track");
		expect(env.updates[0].guest_message?.guest_query_id).toBe(
			guest.payload.guest_query_id,
		);
		expect(env.updates).toHaveLength(1);
		await expect(
			bot.api.answerGuestQuery({
				guest_query_id: guest.payload.guest_query_id ?? "",
				result: {
					type: "article",
					id: "again",
					title: "Again",
					input_message_content: { message_text: "Again" },
				},
			}),
		).rejects.toThrow("already answered");
	});

	it("normalizes guest result keyboards and rejects unknown guest queries", async () => {
		const { bot, env, user } = setup();
		const guest = await user.sendGuestMessage("hello");
		await bot.api.answerGuestQuery({
			guest_query_id: guest.payload.guest_query_id ?? "",
			result: {
				type: "article",
				id: "a",
				title: "A",
				input_message_content: { message_text: "A" },
				reply_markup: new InlineKeyboard().text("Go", "go"),
			},
		});
		expect(
			env.lastApiCall("answerGuestQuery")?.params.result.reply_markup,
		).toMatchObject({
			inline_keyboard: [[{ text: "Go", callback_data: "go" }]],
		});
		await expect(
			bot.api.answerGuestQuery({
				guest_query_id: "missing",
				result: {
					type: "article",
					id: "a",
					title: "A",
					input_message_content: { message_text: "A" },
				},
			}),
		).rejects.toThrow("guest query");
	});

	it("shares a saved result with ownership, allowed-chat and expiration checks", async () => {
		const { bot, env, user } = setup();
		const saved = await bot.api.savePreparedInlineMessage({
			user_id: user.payload.id,
			result: {
				type: "photo",
				id: "cover",
				photo_file_id: "cover-file",
				caption: "Cover",
			},
			allow_group_chats: true,
		});
		const group = env.createChat({ type: "supergroup" });
		const bubble = await user.sendPreparedInlineMessage(saved.id, group);
		expect(bubble.payload.photo?.[0].file_id).toBe("cover-file");
		expect(bubble.payload.caption).toBe("Cover");
		expect(env.updates).toHaveLength(0);
		await expect(user.sendPreparedInlineMessage(saved.id)).rejects.toThrow(
			"not allowed",
		);
		await expect(
			env.createUser().sendPreparedInlineMessage(saved.id, group),
		).rejects.toThrow("another user");
		await expect(
			user.sendPreparedInlineMessage("missing", group),
		).rejects.toThrow("missing or expired");
		expect(saved.expiration_date).toBeGreaterThan(
			Math.floor(Date.now() / 1000),
		);
		const clock = spyOn(Date, "now").mockReturnValue(
			saved.expiration_date * 1000,
		);
		try {
			await expect(
				user.sendPreparedInlineMessage(saved.id, group),
			).rejects.toThrow("expired");
		} finally {
			clock.mockRestore();
		}
	});
});

describe("handler failures and background outcomes", () => {
	it("rejects the action after a handler failure even with a registered error handler", async () => {
		const { bot, env, user } = setup();
		const failure = new Error("handler exploded");
		let reported = false;
		bot.onError(() => {
			reported = true;
		});
		bot.on("message", () => {
			throw failure;
		});
		await expect(user.sendMessage("trigger")).rejects.toBe(failure);
		expect(reported).toBe(true);
		expect(env.errors[0].error).toBe(failure);
	});

	it("supports explicit error-observation mode and keeps concurrent updates separate", async () => {
		const bot = new Bot("test");
		const env = new TelegramTestEnvironment(bot, { throwOnError: false });
		const user = env.createUser();
		bot.on("message", (ctx) => {
			if (ctx.text === "bad") throw new Error("bad");
		});
		await Promise.all([user.sendMessage("bad"), user.sendMessage("good")]);
		expect(env.errors).toHaveLength(1);
		expect(env.errors[0]).toMatchObject({
			updateId: env.updates.find((update) => update.message?.text === "bad")
				?.update_id,
		});
	});

	it("can wait for timer-driven API retries and reports a bounded timeout", async () => {
		const { bot, env, user } = setup();
		let attempts = 0;
		env.onApi("sendMessage", (params) =>
			++attempts === 1
				? apiError(429, "retry")
				: {
						message_id: 1,
						date: 0,
						chat: user.asChat.payload,
						text: String(params.text),
					},
		);
		bot.onResponseError("sendMessage", () => {
			setTimeout(() => {
				void bot.api.sendMessage({ chat_id: user.payload.id, text: "retried" });
			}, 5);
		});
		await expect(
			bot.api.sendMessage({ chat_id: user.payload.id, text: "first" }),
		).rejects.toThrow("retry");
		await env.waitFor(() => env.lastBotMessage()?.payload.text === "retried");
		expect(attempts).toBe(2);
		await expect(env.waitFor(() => false, { timeout: 5 })).rejects.toThrow(
			"timed out",
		);
		await expect(env.waitFor(() => false, { interval: 0 })).rejects.toThrow(
			"positive interval",
		);
		await expect(
			env.waitFor(() => new Promise(() => {}), { timeout: 5 }),
		).rejects.toThrow("timed out");
	});
});

describe("state and boundary regressions", () => {
	it("preserves guest/prepared topics and validates bot-chat sharing separately", async () => {
		const { bot, env, user } = setup();
		const group = env.createChat({ type: "supergroup", is_forum: true });
		const guest = await user.in(group).inTopic(42).sendGuestMessage("hello");
		expect(guest.payload).toMatchObject({
			message_thread_id: 42,
			is_topic_message: true,
		});
		const answered = await bot.api.answerGuestQuery({
			guest_query_id: guest.payload.guest_query_id ?? "",
			result: {
				type: "article",
				id: "a",
				title: "A",
				input_message_content: { message_text: "Answer" },
			},
		});
		expect(
			env.inlineMessage(answered.inline_message_id)?.payload.message_thread_id,
		).toBe(42);
		const prepared = await bot.api.savePreparedInlineMessage({
			user_id: user.payload.id,
			allow_group_chats: true,
			allow_bot_chats: true,
			result: {
				type: "article",
				id: "a",
				title: "A",
				input_message_content: { message_text: "Shared" },
				reply_markup: new InlineKeyboard().text("Go", "go"),
			},
		});
		const bubble = await user
			.in(group)
			.inTopic(42)
			.sendPreparedInlineMessage(prepared.id);
		expect(bubble.payload).toMatchObject({
			message_thread_id: 42,
			is_topic_message: true,
			reply_markup: { inline_keyboard: [[{ text: "Go" }]] },
		});
		await user.sendPreparedInlineMessage(
			prepared.id,
			env.createUser({ is_bot: true }).asChat,
		);
		await expect(user.sendPreparedInlineMessage(prepared.id)).rejects.toThrow(
			"not allowed",
		);
		expect(env.updates).toHaveLength(1);
	});

	it("supports explicit inline input content instead of its media preview", async () => {
		const { bot, user } = setup();
		const results: TelegramInlineQueryResult[] = [
			{
				type: "article",
				id: "loc",
				title: "Location",
				input_message_content: { latitude: 1, longitude: 2 },
			},
			{
				type: "article",
				id: "venue",
				title: "Venue",
				input_message_content: {
					latitude: 1,
					longitude: 2,
					title: "Place",
					address: "Street",
				},
			},
			{
				type: "article",
				id: "contact",
				title: "Contact",
				input_message_content: {
					first_name: "Alice",
					last_name: "Smith",
					phone_number: "+123",
				},
			},
			{
				type: "article",
				id: "invoice",
				title: "Invoice",
				input_message_content: {
					title: "Ticket",
					description: "Admission",
					payload: "ticket",
					currency: "XTR",
					prices: [{ label: "Ticket", amount: 42 }],
				},
			},
		];
		bot.inlineQuery("content", (ctx) => ctx.answer(results));
		const query = await user.sendInlineQuery("content");
		expect(
			(await user.sendInlineResult("loc", query)).payload.location,
		).toMatchObject({ latitude: 1, longitude: 2 });
		expect(
			(await user.sendInlineResult("venue", query)).payload.venue?.title,
		).toBe("Place");
		expect(
			(await user.sendInlineResult("contact", query)).payload.contact
				?.last_name,
		).toBe("Smith");
		expect(
			(await user.sendInlineResult("invoice", query)).payload.invoice,
		).toMatchObject({ title: "Ticket", currency: "XTR", total_amount: 42 });
	});

	it("turns URL media into reusable IDs without colliding with cached fixtures", async () => {
		const { bot, env, user } = setup();
		env.registerFile("upload_1");
		const first = await bot.api.sendAudio({
			chat_id: user.payload.id,
			audio: "https://example.test/track.mp3",
			title: "Track",
		});
		const second = await bot.api.sendAudio({
			chat_id: user.payload.id,
			audio: first.audio?.file_id ?? "",
		});
		expect(first.audio?.file_id).not.toContain("https://");
		expect(first.audio?.file_id).not.toBe("upload_1");
		expect(second.audio).toEqual(first.audio);
		await expect(
			bot.downloadFile(first.audio?.file_id ?? "").text(),
		).rejects.toThrow("No bytes registered");
	});

	it("keeps failures correlated during concurrent updates and removes the observer on dispose", async () => {
		const { bot, env, user } = setup();
		bot.on("message", async (ctx) => {
			if (ctx.text === "bad") {
				await Promise.resolve();
				throw new Error("bad");
			}
		});
		const results = await Promise.allSettled([
			user.sendMessage("bad"),
			user.sendMessage("good"),
		]);
		expect(results.map((result) => result.status)).toEqual([
			"rejected",
			"fulfilled",
		]);
		env.dispose();
		const next = new TelegramTestEnvironment(bot, { throwOnError: false });
		await next.createUser().sendMessage("bad");
		expect(next.errors).toHaveLength(1);
		expect(env.errors).toHaveLength(1);
		next.dispose();
	});

	it("rejects cross-environment guest fixtures and invalid inline/prepared threads", async () => {
		const { bot, env, user } = setup();
		const other = setup();
		const foreign = await other.user.sendAudio();
		await expect(user.sendGuestMessage(foreign)).rejects.toThrow(
			"another test environment",
		);
		const prepared = await bot.api.savePreparedInlineMessage({
			user_id: user.payload.id,
			allow_user_chats: true,
			result: {
				type: "article",
				id: "a",
				title: "A",
				input_message_content: { message_text: "A" },
			},
		});
		await expect(
			user.sendPreparedInlineMessage(prepared.id, user.asChat, {
				message_thread_id: 0,
			}),
		).rejects.toThrow("Invalid message thread");
		await expect(
			user.sendGuestMessage("bad", user.asChat, { message_thread_id: -1 }),
		).rejects.toThrow("Invalid message thread");
		expect(env.updates).toHaveLength(0);
	});
});
