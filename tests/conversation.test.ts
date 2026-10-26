import { describe, expect, it, spyOn } from "bun:test";
import {
	Bot,
	bold,
	format,
	InlineKeyboard,
	Keyboard,
	TelegramError,
} from "gramio";
import {
	apiError,
	MessageObject,
	ReactObject,
	TelegramTestEnvironment,
} from "../src/index.ts";

function setup() {
	const bot = new Bot("test");
	const env = new TelegramTestEnvironment(bot);
	const user = env.createUser();
	const group = env.createChat({
		type: "supergroup",
		title: "Discussion",
		is_forum: true,
	});
	return { bot, env, user, group };
}

describe("API state boundaries", () => {
	it("preserves quiz constraints and rejects changing a non-revotable answer", async () => {
		const { bot, env, user } = setup();
		await bot.api.sendPoll({
			chat_id: user.payload.id,
			question: "Two plus two?",
			options: [{ text: "4" }, { text: "5" }],
			type: "quiz",
			correct_option_ids: [0],
			is_anonymous: false,
		});
		const quiz = env.lastBotMessage();
		if (!quiz) throw new Error("Missing quiz");
		expect(quiz.payload.poll).toMatchObject({
			type: "quiz",
			correct_option_ids: [0],
			allows_revoting: false,
		});
		await user.on(quiz).vote([0]);
		await expect(user.on(quiz).vote([1])).rejects.toThrow(
			"does not allow revoting",
		);
		expect(quiz.payload.poll?.total_voter_count).toBe(1);
	});
	it("replaces media in place and clears the old caption/entities", async () => {
		const { bot, env, user } = setup();
		const photo = await bot.api.sendPhoto({
			chat_id: user.payload.id,
			photo: "photo",
			caption: format`${bold("old")}`,
		});
		const bubble = env.lastBotMessage();
		await bot.api.editMessageMedia({
			chat_id: user.payload.id,
			message_id: photo.message_id,
			media: { type: "video", media: "video" },
		});
		expect(env.botMessage(user.payload.id, photo.message_id)).toBe(bubble);
		expect(bubble?.payload.video?.file_id).toBe("video");
		expect(bubble?.payload.photo).toBeUndefined();
		expect(bubble?.payload.caption).toBeUndefined();
		expect(bubble?.payload.caption_entities).toBeUndefined();
	});
	it("keeps pins, chat reads, and batch deletion consistent", async () => {
		const { bot, env, group } = setup();
		const first = await bot.api.sendMessage({
			chat_id: group.payload.id,
			text: "one",
		});
		const second = await bot.api.sendMessage({
			chat_id: group.payload.id,
			text: "two",
		});
		const reference = env.lastBotMessage();
		await bot.api.pinChatMessage({
			chat_id: group.payload.id,
			message_id: second.message_id,
		});
		expect(
			(await bot.api.getChat({ chat_id: group.payload.id })).pinned_message
				?.message_id,
		).toBe(second.message_id);
		await bot.api.unpinChatMessage({ chat_id: group.payload.id });
		expect(group.pinnedMessage).toBeUndefined();
		await bot.api.pinChatMessage({
			chat_id: group.payload.id,
			message_id: second.message_id,
		});
		await bot.api.deleteMessages({
			chat_id: group.payload.id,
			message_ids: [first.message_id, second.message_id],
		});
		expect(group.messages).toEqual([]);
		expect(group.pinnedMessage).toBeUndefined();
		expect(reference?.isDeleted).toBe(true);
	});
	it("stores commands independently by scope and language", async () => {
		const { bot, group } = setup();
		const commands = [{ command: "start", description: "Start" }];
		await bot.api.setMyCommands({ commands });
		await bot.api.setMyCommands({
			commands: [{ command: "help", description: "Help" }],
			language_code: "en",
			scope: { type: "chat", chat_id: group.payload.id },
		});
		expect(await bot.api.getMyCommands()).toEqual(commands);
		expect(await bot.api.getMyCommands({ language_code: "en" })).toEqual([]);
		expect(
			await bot.api.getMyCommands({
				language_code: "en",
				scope: { type: "chat", chat_id: group.payload.id },
			}),
		).toHaveLength(1);
		await bot.api.deleteMyCommands();
		expect(await bot.api.getMyCommands()).toEqual([]);
	});
	it("rejects missing reply targets without adding a bubble", async () => {
		const { bot, env, user } = setup();
		await expect(
			bot.api.sendMessage({
				chat_id: user.payload.id,
				text: "reply",
				reply_parameters: { message_id: 100 },
			}),
		).rejects.toThrow("reply not found");
		expect(user.asChat.messages).toEqual([]);
		await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: "reply",
			reply_parameters: { message_id: 100, allow_sending_without_reply: true },
		});
		expect(env.lastBotMessage()?.payload.reply_to_message).toBeUndefined();
	});
	it("rejects duplicate mock IDs without overwriting incoming state", async () => {
		const { bot, env, user } = setup();
		const input = await user.sendMessage("original");
		env.onApi("sendMessage", {
			...input.payload,
			chat: user.asChat.payload,
			text: "collision",
		});
		await expect(
			bot.api.sendMessage({ chat_id: user.payload.id, text: "collision" }),
		).rejects.toThrow("duplicate message id");
		expect(input.payload.text).toBe("original");
		expect(user.asChat.messages).toEqual([input]);
	});
	it("does not approve a payment when API acknowledgement failed", async () => {
		const { bot, env, user } = setup();
		bot.on("pre_checkout_query", (ctx) =>
			bot.api.answerPreCheckoutQuery({
				pre_checkout_query_id: ctx.id,
				ok: true,
				suppress: true,
			}),
		);
		env.onApi("answerPreCheckoutQuery", apiError(400, "query expired"));
		await expect(user.sendSuccessfulPayment()).rejects.toThrow(
			"approval failed",
		);
		expect(
			env.updates.some((update) => update.message?.successful_payment),
		).toBe(false);
	});
	it("prevents double attachment and permits reuse after disposal", async () => {
		const { bot, env } = setup();
		expect(() => new TelegramTestEnvironment(bot)).toThrow(
			"already has a test environment",
		);
		env.dispose();
		const replacement = new TelegramTestEnvironment(bot);
		expect(await bot.api.getMe()).toEqual(replacement.botUser);
		replacement.dispose();
	});
	it("does not consume standalone fixture IDs when sending a builder", async () => {
		const { user } = setup();
		const fixture = new MessageObject({ message_id: 10000 })
			.from(user)
			.text("fixture");
		const first = await user.send(fixture);
		const second = await user.sendMessage("next");
		expect(first.payload.message_id).toBe(1);
		expect(second.payload.message_id).toBe(2);
	});
	it("carries topic context through every scoped media action", async () => {
		const { env, user, group } = setup();
		const topic = user.in(group).inTopic(41);
		const messages = await Promise.all([
			topic.sendPhoto(),
			topic.sendVideo(),
			topic.sendDocument(),
			topic.sendVoice(),
			topic.sendAudio(),
			topic.sendAnimation(),
			topic.sendVideoNote(),
			topic.sendSticker(),
			topic.sendLocation({ latitude: 1, longitude: 2 }),
			topic.sendContact({ first_name: "Alice" }),
			topic.sendDice(),
		]);
		for (const message of messages) {
			expect(message.payload.chat?.id).toBe(group.payload.id);
			expect(message.payload.message_thread_id).toBe(41);
			expect(message.payload.is_topic_message).toBe(true);
		}
		expect(
			new Set(messages.map((message) => message.payload.message_id)).size,
		).toBe(messages.length);
		expect(env.updates).toHaveLength(messages.length);
	});
});

describe("conversation state", () => {
	it("shares message IDs and history across users and bot, preserving chat/sender/thread", async () => {
		const { bot, env, user, group } = setup();
		bot.on("message", (ctx) =>
			ctx.send("reply", { message_thread_id: ctx.threadId }),
		);
		const input = await user.in(group).inTopic(41).sendMessage("hello");
		const reply = env.lastBotMessage();
		if (!reply) throw new Error("Missing reply");
		expect(reply?.payload).toMatchObject({
			message_id: input.payload.message_id + 1,
			chat: group.payload,
			from: env.botUser,
			message_thread_id: 41,
		});
		expect(group.messages).toEqual([input, reply]);
		expect(reply?.payload.chat?.type).toBe("supergroup");
	});
	it("replies to bot bubbles in their own chat", async () => {
		const { bot, env, user, group } = setup();
		await bot.api.sendMessage({
			chat_id: group.payload.id,
			text: "Question",
			message_thread_id: 41,
		});
		const bubble = env.lastBotMessage();
		if (!bubble) throw new Error("Missing bubble");
		const reply = await user.on(bubble).reply("Answer");
		expect(reply.payload.chat?.id).toBe(group.payload.id);
		expect(reply.payload.message_thread_id).toBe(41);
	});
	it("keeps live references after clearing observations", async () => {
		const { bot, env, user } = setup();
		const sent = await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: "old",
		});
		const bubble = env.lastBotMessage();
		env.clearApiCalls();
		expect(env.apiCalls).toEqual([]);
		expect(env.botMessage(user.payload.id, sent.message_id)).toBe(bubble);
		await bot.api.editMessageText({
			chat_id: user.payload.id,
			message_id: sent.message_id,
			text: "new",
		});
		expect(bubble?.payload.text).toBe("new");
	});
	it("does not mutate a message on failed or suppressed edits", async () => {
		const { bot, env, user } = setup();
		const sent = await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: "old",
		});
		const bubble = env.lastBotMessage();
		env.onApi("editMessageText", apiError(400, "bad edit"));
		await expect(
			bot.api.editMessageText({
				chat_id: user.payload.id,
				message_id: sent.message_id,
				text: "bad",
			}),
		).rejects.toThrow("bad edit");
		expect(
			await bot.api.editMessageText({
				chat_id: user.payload.id,
				message_id: sent.message_id,
				text: "bad",
				suppress: true,
			}),
		).toBeInstanceOf(TelegramError);
		expect(bubble?.payload.text).toBe("old");
	});
	it("deletes messages from lookup/history and rejects further user interactions", async () => {
		const { bot, env, user } = setup();
		const sent = await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: "menu",
			reply_markup: new InlineKeyboard().text("Next", "next"),
		});
		const bubble = env.lastBotMessage();
		if (!bubble) throw new Error("Missing bubble");
		await bot.api.deleteMessage({
			chat_id: user.payload.id,
			message_id: sent.message_id,
		});
		expect(bubble.isDeleted).toBe(true);
		expect(user.asChat.messages).not.toContain(bubble);
		expect(env.botMessage(user.payload.id, sent.message_id)).toBeUndefined();
		expect(() => user.on(bubble).clickByText("Next")).toThrow("deleted");
		await expect(user.sendReply(bubble, "x")).rejects.toThrow("deleted");
		await expect(
			bot.api.editMessageText({
				chat_id: user.payload.id,
				message_id: sent.message_id,
				text: "x",
			}),
		).rejects.toThrow("not found");
	});
	it("allocates unique IDs concurrently and isolates counters between environments", async () => {
		const { env, user } = setup();
		const messages = await Promise.all(
			Array.from({ length: 25 }, (_, i) => user.sendMessage(String(i))),
		);
		expect(new Set(messages.map((m) => m.payload.message_id)).size).toBe(25);
		const other = new TelegramTestEnvironment(new Bot("other"));
		const second = other.createUser({ id: user.payload.id });
		expect((await second.sendMessage("new world")).payload.message_id).toBe(1);
		expect(env.updates[0]?.update_id).toBe(0);
		expect(other.updates[0]?.update_id).toBe(0);
	});
	it("rejects cross-environment actors, chats, and duplicate identities", async () => {
		const { env, user, group } = setup();
		const other = new TelegramTestEnvironment(new Bot("other"));
		expect(() => other.createUser(user)).toThrow("another test environment");
		await expect(other.createUser().sendMessage(group, "x")).rejects.toThrow(
			"another test environment",
		);
		expect(() => env.createUser({ id: user.payload.id })).toThrow(
			"already registered",
		);
		expect(() => env.createChat({ id: group.payload.id })).toThrow(
			"already registered",
		);
		expect(env.createUser(user)).toBe(user);
		expect(env.users.filter((item) => item === user)).toHaveLength(1);
	});
	it("snapshots recorded calls, responses and incoming updates", async () => {
		const { bot, env, user } = setup();
		const params = { chat_id: user.payload.id, text: "before" };
		const result = await bot.api.sendMessage(params);
		params.text = "after";
		result.text = "after";
		expect(env.lastApiCall("sendMessage")?.params.text).toBe("before");
		const recorded = env.lastApiCall("sendMessage")?.response;
		if (!recorded || recorded instanceof TelegramError)
			throw new Error("Expected a successful send");
		expect(recorded.text).toBe("before");
		const message = await user.sendMessage("before");
		await user.editMessage(message, "after");
		expect(env.updates[0]?.message?.text).toBe("before");
	});
});

describe("request lifecycle", () => {
	it("runs wrappers, format/pre-request and response hooks in order", async () => {
		const { bot, env, user } = setup();
		const events: string[] = [];
		bot.onApiCall(async (_ctx, next) => {
			events.push("before");
			const response = await next();
			events.push("after");
			return response;
		});
		bot.preRequest("sendMessage", (ctx) => {
			events.push("request");
			expect(ctx.params.text).toBe("Hello world");
			return ctx;
		});
		bot.onResponse("sendMessage", () => {
			events.push("response");
		});
		await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: format`Hello ${bold("world")}`,
		});
		expect(events).toEqual(["before", "request", "response", "after"]);
		expect(env.lastBotMessage()?.payload.entities).toEqual([
			{ type: "bold", offset: 6, length: 5 },
		]);
	});
	it("supports asynchronous mocks and error hooks with suppress", async () => {
		const { bot, env, user } = setup();
		let errors = 0;
		bot.onResponseError("sendMessage", () => {
			errors++;
		});
		env.onApi("sendMessage", async () =>
			apiError(429, "slow down", { retry_after: 1 }),
		);
		const result = await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: "x",
			suppress: true,
		});
		expect(result).toBeInstanceOf(TelegramError);
		expect(errors).toBe(1);
		expect(env.lastBotMessage()).toBeUndefined();
	});
	it("allows retry wrappers to execute a fresh mocked request", async () => {
		const { bot, env, user } = setup();
		let attempts = 0;
		env.onApi("sendMessage", (params) =>
			++attempts === 1
				? apiError(429, "retry")
				: {
						message_id: 70,
						date: 1,
						chat: user.asChat.payload,
						text: String(params.text),
					},
		);
		bot.onApiCall(async (_ctx, next) => {
			try {
				return await next();
			} catch (error) {
				if (error instanceof TelegramError && error.code === 429) return next();
				throw error;
			}
		});
		await bot.api.sendMessage({ chat_id: user.payload.id, text: "x" });
		expect(attempts).toBe(2);
		expect(env.apiCalls).toHaveLength(2);
		expect(env.lastBotMessage()?.payload.text).toBe("x");
	});
	it("uses state-backed reads and rejects unsupported methods with a useful mock hint", async () => {
		const { bot, env, user, group } = setup();
		expect(await bot.api.getMe()).toEqual(env.botUser);
		expect((await bot.api.getChat({ chat_id: group.payload.id })).type).toBe(
			"supergroup",
		);
		await user.join(group);
		expect(
			(
				await bot.api.getChatMember({
					chat_id: group.payload.id,
					user_id: user.payload.id,
				})
			).status,
		).toBe("member");
		await user.leave(group);
		expect(
			(
				await bot.api.getChatMember({
					chat_id: group.payload.id,
					user_id: user.payload.id,
				})
			).status,
		).toBe("left");
		await expect(bot.api.getWebhookInfo()).rejects.toThrow(
			'env.onApi("getWebhookInfo"',
		);
	});
	it("restores the original bot API on disposal", () => {
		const bot = new Bot("test");
		const original = bot.api;
		const env = new TelegramTestEnvironment(bot);
		env.dispose();
		env.dispose();
		expect(bot.api).toBe(original);
		expect(() => env.emitUpdate(new MessageObject())).toThrow("disposed");
	});
});

describe("reply and topic scenarios", () => {
	it("preserves manual .chat() and thread through text, media and nested replies", async () => {
		const { user, group } = setup();
		const original = new MessageObject({
			message_id: 45,
			message_thread_id: 41,
		}).chat(group);
		const first = await user.sendReply(original, "first");
		const second = await user.sendMessage(group, "second", { reply_to: first });
		const photo = await user.sendPhoto(group, { reply_to: second });
		for (const message of [first, second, photo]) {
			expect(message.payload.chat?.id).toBe(group.payload.id);
			expect(message.payload.message_thread_id).toBe(41);
		}
		expect(photo.payload.reply_to_message?.reply_to_message).toBeUndefined();
	});
	it("does not rewrite earlier replies when the parent is edited", async () => {
		const { user } = setup();
		const parent = await user.sendMessage("original");
		const reply = await user.sendReply(parent, "reply");
		await user.editMessage(parent, "changed");
		expect(reply.payload.reply_to_message?.text).toBe("original");
	});
	it("rejects chat/thread scope conflicts", async () => {
		const { user, group } = setup();
		const pm = await user.sendMessage("pm");
		expect(() => user.in(group).sendReply(pm, "x")).toThrow("scoped chat");
		const root = await user.in(group).inTopic(4).sendMessage("root");
		await expect(
			user.in(group).inTopic(5).sendReply(root, "x"),
		).rejects.toThrow("another thread");
		expect(() => user.in(group).inTopic(0)).toThrow("positive integer");
	});
	it("creates an explicit discussion root and routes the first and nested comments", async () => {
		const { env, user, group } = setup();
		const channel = env.createChat({ type: "channel", title: "News" });
		const post = await channel.post("News");
		const root = await env.createDiscussion(post, group);
		const first = await user.on(root).reply("First");
		const nested = await user.on(first).reply("Nested");
		expect(root.payload).toMatchObject({
			is_automatic_forward: true,
			sender_chat: channel.payload,
			forward_origin: { type: "channel", message_id: post.payload.message_id },
		});
		for (const message of [first, nested]) {
			expect(message.payload.message_thread_id).toBe(root.payload.message_id);
			expect(message.payload.chat?.id).toBe(group.payload.id);
		}
	});
	it("supports topic commands and media with the same context", async () => {
		const { bot, user, group } = setup();
		const threads: (number | undefined)[] = [];
		bot.on("message", (ctx) => {
			threads.push(ctx.threadId);
		});
		await user.in(group).inTopic(7).sendCommand("/start");
		await user.in(group).inTopic(7).sendPhoto();
		expect(threads).toEqual([7, 7]);
		expect(group.messages.every((m) => m.payload.is_topic_message)).toBe(true);
	});
});

describe("media and interaction scenarios", () => {
	for (const kind of [
		"photo",
		"video",
		"document",
		"audio",
		"voice",
		"animation",
		"video_note",
		"sticker",
	] as const) {
		it(`tracks a bot ${kind} with buttons in the correct chat`, async () => {
			const { bot, env, user, group } = setup();
			let clicked = false;
			bot.callbackQuery("next", () => {
				clicked = true;
			});
			const params = {
				chat_id: group.payload.id,
				reply_markup: new InlineKeyboard().text("Next", "next"),
			};
			const sends = {
				photo: () => bot.api.sendPhoto({ ...params, photo: "file" }),
				video: () => bot.api.sendVideo({ ...params, video: "file" }),
				document: () => bot.api.sendDocument({ ...params, document: "file" }),
				audio: () => bot.api.sendAudio({ ...params, audio: "file" }),
				voice: () => bot.api.sendVoice({ ...params, voice: "file" }),
				animation: () =>
					bot.api.sendAnimation({ ...params, animation: "file" }),
				video_note: () =>
					bot.api.sendVideoNote({ ...params, video_note: "file" }),
				sticker: () => bot.api.sendSticker({ ...params, sticker: "file" }),
			};
			await sends[kind]();
			const bubble = env.lastBotMessage();
			if (!bubble) throw new Error("Missing media bubble");
			expect(bubble.payload[kind]).toBeDefined();
			expect(bubble.payload.chat).toEqual(group.payload);
			await user.on(bubble).clickByText("Next");
			expect(clicked).toBe(true);
		});
	}
	it("supports an entire photo menu → edit → click → reply → delete flow", async () => {
		const { bot, env, user, group } = setup();
		bot.command("start", (ctx) =>
			ctx.sendPhoto("file", {
				caption: format`${bold("Pick")}`,
				reply_markup: new InlineKeyboard().text("Next", "next"),
			}),
		);
		bot.callbackQuery("next", async (ctx) => {
			await ctx.answer();
			await ctx.editCaption("Done", {
				reply_markup: new InlineKeyboard().text("Finish", "finish"),
			});
		});
		await user.in(group).sendMessage("/start");
		const bubble = env.lastBotMessage();
		if (!bubble) throw new Error("Missing bubble");
		await user.on(bubble).clickByText("Next");
		expect(bubble.payload.caption).toBe("Done");
		expect(bubble.payload.caption_entities).toBeUndefined();
		const reply = await user.on(bubble).reply("thanks");
		expect(reply.payload.reply_to_message?.caption).toBe("Done");
		await bot.api.deleteMessage({
			chat_id: group.payload.id,
			message_id: bubble.payload.message_id,
		});
		expect(group.messages).not.toContain(bubble);
	});
	it("keeps albums distinct under a frozen clock and tracks bot albums", async () => {
		const { bot, env, user, group } = setup();
		const clock = spyOn(Date, "now").mockReturnValue(1234567890000);
		try {
			const items = [
				new MessageObject().photo().payload,
				new MessageObject().photo().payload,
			];
			const first = await user.sendMediaGroup(group, items);
			const second = await user.sendMediaGroup(group, items);
			expect(first[0].payload.media_group_id).not.toBe(
				second[0].payload.media_group_id,
			);
			const sent = await bot.api.sendMediaGroup({
				chat_id: group.payload.id,
				media: [
					{ type: "photo", media: "one" },
					{ type: "photo", media: "two" },
				],
			});
			expect(sent.map((m) => m.message_id)).toEqual([5, 6]);
			expect(env.lastBotMessage()?.payload.message_id).toBe(6);
		} finally {
			clock.mockRestore();
		}
	});
	it("presses text and contact reply-keyboard buttons", async () => {
		const { bot, env, user } = setup();
		await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: "Choose",
			reply_markup: new Keyboard().text("Hello").requestContact("Share"),
		});
		const bubble = env.lastBotMessage();
		if (!bubble) throw new Error("Missing bubble");
		expect((await user.on(bubble).press("Hello")).payload.text).toBe("Hello");
		expect(
			(await user.on(bubble).press("Share")).payload.contact?.user_id,
		).toBe(user.payload.id);
	});
	it("materializes an answered inline article and clicks its button", async () => {
		const { bot, env, user, group } = setup();
		let clicked = false;
		bot.inlineQuery("find", (ctx) =>
			ctx.answer([
				{
					type: "article",
					id: "a",
					title: "A",
					input_message_content: { message_text: format`${bold("Article")}` },
					reply_markup: new InlineKeyboard().text("Open", "open"),
				},
			]),
		);
		bot.callbackQuery("open", () => {
			clicked = true;
		});
		const query = await user.sendInlineQuery("find", group);
		const message = await user.sendInlineResult("a", query, group);
		expect(message.payload.text).toBe("Article");
		expect(message.payload.entities?.[0].type).toBe("bold");
		expect(message.payload.via_bot).toEqual(env.botUser);
		await user.on(message).clickByText("Open");
		expect(clicked).toBe(true);
	});
	it("votes, changes and retracts a vote without accumulating voter counts", async () => {
		const { bot, env, user } = setup();
		await bot.api.sendPoll({
			chat_id: user.payload.id,
			question: "Choose",
			options: [{ text: "A" }, { text: "B" }],
			is_anonymous: false,
		});
		const message = env.lastBotMessage();
		if (!message) throw new Error("Missing poll");
		await user.on(message).vote([0]);
		await user.on(message).vote([1]);
		expect(message.payload.poll?.options.map((o) => o.voter_count)).toEqual([
			0, 1,
		]);
		await user.on(message).vote([]);
		expect(message.payload.poll?.total_voter_count).toBe(0);
		expect(env.updates.at(-1)?.poll_answer?.option_ids).toEqual([]);
		await expect(user.on(message).vote([3])).rejects.toThrow("Invalid");
	});
});

describe("builders and actor consistency", () => {
	it("replaces stale formatting and uses seconds/unique fixture IDs", () => {
		const a = new MessageObject()
			.text(format`${bold("long")}`)
			.text("x")
			.caption(format`${bold("caption")}`)
			.caption("plain");
		const b = new MessageObject();
		expect(a.payload.message_id).not.toBe(b.payload.message_id);
		expect(a.payload.entities).toBeUndefined();
		expect(a.payload.caption_entities).toBeUndefined();
		expect(a.payload.date).toBeLessThan(10_000_000_000);
	});
	it("sends a builder through the high-level actor API but keeps raw injection low-level", async () => {
		const { env, user, group } = setup();
		const fixture = new MessageObject()
			.chat(group)
			.location({ latitude: 1, longitude: 2 });
		const sent = await user.send(fixture);
		expect(group.messages).toContain(sent);
		expect(sent.payload.from).toEqual(user.payload);
		const raw = new MessageObject().chat(group).text("raw");
		await env.emitUpdate(raw);
		expect(group.messages).not.toContain(raw);
	});
	it("forwards a channel origin without leaking its thread into another chat", async () => {
		const { env, user } = setup();
		const channel = env.createChat({ type: "channel", title: "News" });
		const post = await channel.post("news");
		post.payload.message_thread_id = 99;
		const forwarded = await user.on(post).forward();
		expect(forwarded.payload.forward_origin).toMatchObject({
			type: "channel",
			chat: channel.payload,
			message_id: post.payload.message_id,
		});
		expect(forwarded.payload.message_thread_id).toBeUndefined();
	});
	it("tracks reaction overrides by the actual actor and safely reuses builders", async () => {
		const { env, user } = setup();
		const bob = env.createUser();
		const message = await user.sendMessage("react");
		const reaction = new ReactObject().on(message).from(bob).add("❤");
		await user.react(reaction);
		await user.react(reaction);
		expect(message.reactions.get(bob.payload.id)).toEqual(["❤"]);
		expect(message.reactions.has(user.payload.id)).toBe(false);
		expect(env.updates.at(-1)?.message_reaction?.old_reaction).toEqual([
			{ type: "emoji", emoji: "❤" },
		]);
		expect(reaction.payload.old_reaction).toEqual([]);
	});
	it("makes repeated membership actions idempotent", async () => {
		const { env, user, group } = setup();
		await user.join(group);
		await user.join(group);
		await user.leave(group);
		await user.leave(group);
		expect(env.updates.filter((u) => u.chat_member)).toHaveLength(2);
		expect(group.members.size).toBe(0);
	});
	it("edits channel posts using edited_channel_post and rejects user edits", async () => {
		const { env, user } = setup();
		const channel = env.createChat({ type: "channel", title: "News" });
		const post = await channel.post("old");
		await expect(user.editMessage(post, "wrong actor")).rejects.toThrow(
			"own messages",
		);
		await channel.editPost(post, "new");
		expect(env.updates.at(-1)?.edited_channel_post?.text).toBe("new");
	});
});
