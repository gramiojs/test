import { describe, expect, it } from "bun:test";
import { Bot, bold, format, InlineKeyboard } from "gramio";
import { apiError, TelegramTestEnvironment } from "../src/index.ts";

function setup() {
	const bot = new Bot("test");
	const env = new TelegramTestEnvironment(bot);
	const user = env.createUser();
	const group = env.createChat({
		type: "supergroup",
		title: "Destination",
		is_forum: true,
	});
	return { bot, env, user, group };
}

describe("zero-configuration API defaults", () => {
	it("replies across chats using external metadata without leaking the source topic", async () => {
		const { bot, user, group } = setup();
		const photo = await user.in(group).inTopic(41).sendPhoto();
		const reply = await bot.api.sendMessage({
			chat_id: user.payload.id,
			text: "Reply",
			reply_parameters: {
				chat_id: group.payload.id,
				message_id: photo.payload.message_id,
			},
		});
		expect(reply.reply_to_message).toBeUndefined();
		expect(reply.message_thread_id).toBeUndefined();
		expect(reply.external_reply).toMatchObject({
			chat: group.payload,
			message_id: photo.payload.message_id,
			origin: { type: "user", sender_user: user.payload },
			photo: photo.payload.photo,
		});
		await expect(
			bot.api.sendMessage({
				chat_id: user.payload.id,
				text: "Missing",
				reply_parameters: {
					chat_id: group.payload.id,
					message_id: 10000,
					allow_sending_without_reply: true,
				},
			}),
		).rejects.toThrow("reply not found");
	});
	it("forwards incoming messages with a new identity and destination thread", async () => {
		const { bot, env, user, group } = setup();
		const incoming = await user.sendMessage(format`${bold("Hello")}`);
		const forwarded = await bot.api.forwardMessage({
			chat_id: group.payload.id,
			from_chat_id: user.payload.id,
			message_id: incoming.payload.message_id,
			message_thread_id: 41,
		});
		expect(forwarded).toMatchObject({
			text: "Hello",
			chat: group.payload,
			message_thread_id: 41,
			forward_origin: { type: "user", sender_user: user.payload },
		});
		expect(forwarded.entities).toEqual(incoming.payload.entities);
		const bubble = env.lastBotMessage();
		if (!bubble) throw new Error("Missing forwarded bubble");
		const reply = await user.on(bubble).reply("Thanks");
		expect(reply.payload.chat?.id).toBe(group.payload.id);
		expect(reply.payload.message_thread_id).toBe(41);
	});
	it("copies media with formatted caption/buttons and tracks its ID-only result", async () => {
		const { bot, env, user, group } = setup();
		const photo = await user.sendPhoto({ caption: "Original" });
		const copied = await bot.api.copyMessage({
			chat_id: group.payload.id,
			from_chat_id: user.payload.id,
			message_id: photo.payload.message_id,
			caption: format`${bold("Copy")}`,
			reply_markup: new InlineKeyboard().text("Open", "open"),
		});
		expect(Object.keys(copied)).toEqual(["message_id"]);
		const bubble = env.botMessage(group.payload.id, copied.message_id);
		if (!bubble) throw new Error("Missing copied bubble");
		expect(env.lastBotMessage()).toBe(bubble);
		expect(bubble.payload.caption).toBe("Copy");
		expect(bubble.payload.caption_entities).toEqual([
			{ type: "bold", offset: 0, length: 4 },
		]);
		expect(bubble.payload.forward_origin).toBeUndefined();
		let clicked = false;
		bot.callbackQuery("open", (ctx) => {
			clicked = true;
			return ctx.answer();
		});
		await user.on(bubble).clickByText("Open");
		expect(clicked).toBe(true);
		expect(photo.payload.caption).toBe("Original");
	});
	for (const method of ["forwardMessages", "copyMessages"] as const) {
		it(`${method} keeps album grouping and skips unavailable messages`, async () => {
			const { bot, env, user, group } = setup();
			const source = await bot.api.sendMediaGroup({
				chat_id: user.payload.id,
				media: [
					{ type: "photo", media: "one", caption: "Caption" },
					{ type: "photo", media: "two" },
				],
			});
			const result = await bot.api[method]({
				chat_id: group.payload.id,
				from_chat_id: user.payload.id,
				message_ids: [...source.map((message) => message.message_id), 10000],
				remove_caption: true,
			});
			expect(result).toHaveLength(2);
			expect(group.messages).toHaveLength(2);
			expect(group.messages[0].payload.media_group_id).toBe(
				group.messages[1].payload.media_group_id,
			);
			expect(group.messages[0].payload.media_group_id).not.toBe(
				source[0].media_group_id,
			);
			expect(env.lastBotMessage()).toBe(group.messages[1]);
			if (method === "copyMessages")
				expect(group.messages[0].payload.caption).toBeUndefined();
			expect(env.lastApiCall(method)?.response).toEqual(result);
		});
	}
	it("rejects protected forwards and leaves the destination unchanged", async () => {
		const { bot, user, group } = setup();
		const protectedMessage = (await user.sendMessage("Secret")).protect();
		await expect(
			bot.api.forwardMessage({
				chat_id: group.payload.id,
				from_chat_id: user.payload.id,
				message_id: protectedMessage.payload.message_id,
			}),
		).rejects.toThrow("can't be forwarded");
		expect(group.messages).toEqual([]);
	});
	it("keeps the original channel attribution through a second forward", async () => {
		const { bot, env, user, group } = setup();
		const channel = env.createChat({ type: "channel", title: "News" });
		const post = await channel.post("News");
		const forwarded = await bot.api.forwardMessage({
			chat_id: group.payload.id,
			from_chat_id: channel.payload.id,
			message_id: post.payload.message_id,
		});
		const next = await bot.api.forwardMessage({
			chat_id: user.payload.id,
			from_chat_id: group.payload.id,
			message_id: forwarded.message_id,
		});
		expect(next.forward_origin).toMatchObject({
			type: "channel",
			chat: channel.payload,
			message_id: post.payload.message_id,
		});
	});
	it("closes a poll in place and prevents subsequent voting", async () => {
		const { bot, env, user } = setup();
		const sent = await bot.api.sendPoll({
			chat_id: user.payload.id,
			question: "Choose",
			options: [{ text: "One" }, { text: "Two" }],
			is_anonymous: false,
		});
		const bubble = env.lastBotMessage();
		if (!bubble) throw new Error("Missing poll bubble");
		await user.on(bubble).vote([0]);
		const poll = await bot.api.stopPoll({
			chat_id: user.payload.id,
			message_id: sent.message_id,
		});
		expect(poll).toMatchObject({ is_closed: true, total_voter_count: 1 });
		expect(bubble.payload.poll?.is_closed).toBe(true);
		poll.options[0].voter_count = 100;
		expect(bubble.payload.poll?.options[0].voter_count).toBe(1);
		await expect(user.on(bubble).vote([1])).rejects.toThrow(
			"open, non-anonymous poll",
		);
	});
	it("edits and stops a live location on the same reference", async () => {
		const { bot, env, user } = setup();
		const sent = await bot.api.sendLocation({
			chat_id: user.payload.id,
			latitude: 1,
			longitude: 2,
			live_period: 900,
		});
		const bubble = env.lastBotMessage();
		await bot.api.editMessageLiveLocation({
			chat_id: user.payload.id,
			message_id: sent.message_id,
			latitude: 3,
			longitude: 4,
			heading: 90,
		});
		expect(bubble?.payload.location).toMatchObject({
			latitude: 3,
			longitude: 4,
			live_period: 900,
			heading: 90,
		});
		await bot.api.stopMessageLiveLocation({
			chat_id: user.payload.id,
			message_id: sent.message_id,
		});
		expect(bubble?.payload.location?.live_period).toBeUndefined();
		await expect(
			bot.api.editMessageLiveLocation({
				chat_id: user.payload.id,
				message_id: sent.message_id,
				latitude: 5,
				longitude: 6,
			}),
		).rejects.toThrow("not active");
		expect(bubble?.payload.location?.latitude).toBe(3);
	});
	it("supports profile/menu setup and reads without manual mocks", async () => {
		const { bot, user } = setup();
		await bot.api.setMyName({ name: "Name" });
		expect((await bot.api.getMe()).first_name).toBe("Name");
		await bot.api.setMyName({ name: "Имя", language_code: "ru" });
		expect(await bot.api.getMyName({ language_code: "ru" })).toEqual({
			name: "Имя",
		});
		expect(await bot.api.getMyName({ language_code: "en" })).toEqual({
			name: "Name",
		});
		await bot.api.setMyDescription({ description: "Description" });
		await bot.api.setMyShortDescription({ short_description: "Short" });
		expect(await bot.api.getMyDescription()).toEqual({
			description: "Description",
		});
		expect(await bot.api.getMyShortDescription()).toEqual({
			short_description: "Short",
		});
		await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
		await bot.api.setChatMenuButton({
			chat_id: user.payload.id,
			menu_button: {
				type: "web_app",
				text: "Open",
				web_app: { url: "https://example.com" },
			},
		});
		expect(await bot.api.getChatMenuButton()).toEqual({ type: "commands" });
		expect(
			await bot.api.getChatMenuButton({ chat_id: user.payload.id }),
		).toMatchObject({ type: "web_app", text: "Open" });
		await bot.api.setChatMenuButton({ chat_id: user.payload.id });
		expect(
			await bot.api.getChatMenuButton({ chat_id: user.payload.id }),
		).toEqual({ type: "commands" });
		expect(
			await bot.api.getUserProfilePhotos({ user_id: user.payload.id }),
		).toEqual({ total_count: 0, photos: [] });
	});
	it("restores built-ins after removing a custom override", async () => {
		const { bot, env, user, group } = setup();
		const incoming = await user.sendMessage("Hello");
		const params = {
			chat_id: group.payload.id,
			from_chat_id: user.payload.id,
			message_id: incoming.payload.message_id,
		};
		env.onApi("copyMessage", apiError(400, "custom failure"));
		await expect(bot.api.copyMessage(params)).rejects.toThrow("custom failure");
		expect(group.messages).toEqual([]);
		env.offApi("copyMessage");
		const copied = await bot.api.copyMessage(params);
		expect(
			env.botMessage(group.payload.id, copied.message_id)?.payload.text,
		).toBe("Hello");
	});
});
