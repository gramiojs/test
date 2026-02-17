import { describe, expect, it } from "bun:test";
import { Bot, TelegramError, type ContextType } from "gramio";
import {
	CallbackQueryObject,
	ChatObject,
	ChosenInlineResultObject,
	InlineQueryObject,
	MessageObject,
	ReactObject,
	TelegramTestEnvironment,
	UserObject,
	apiError,
} from "../src/index.ts";

describe("TelegramTestEnvironment", () => {
	it("should create a user", () => {
		const bot = new Bot("test");
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		expect(user).toBeInstanceOf(UserObject);
		expect(env.users).toContain(user);
		expect(user.environment).toBe(env);
	});

	it("should create a user with custom properties", () => {
		const bot = new Bot("test");
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });

		expect(user.payload.first_name).toBe("Alice");
		expect(user.payload.is_bot).toBe(false);
	});

	it("should assign unique user IDs", () => {
		const bot = new Bot("test");
		const env = new TelegramTestEnvironment(bot);
		const user1 = env.createUser();
		const user2 = env.createUser();

		expect(user1.payload.id).not.toBe(user2.payload.id);
	});

	it("should accept an existing UserObject", () => {
		const bot = new Bot("test");
		const env = new TelegramTestEnvironment(bot);
		const user = new UserObject({ first_name: "Existing" });
		const returned = env.createUser(user);

		expect(returned).toBe(user);
		expect(user.environment).toBe(env);
		expect(env.users).toContain(user);
	});

	it("should create a chat", () => {
		const bot = new Bot("test");
		const env = new TelegramTestEnvironment(bot);
		const chat = env.createChat({ type: "group", title: "Test Group" });

		expect(chat).toBeInstanceOf(ChatObject);
		expect(chat.payload.type).toBe("group");
		expect(chat.payload.title).toBe("Test Group");
		expect(env.chats).toContain(chat);
	});

	it("should emit update from MessageObject (legacy API)", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const message = new MessageObject({
			text: "Hello",
		}).from(user);

		await env.emitUpdate(message);

		expect(received).toBeDefined();
		expect(received?.text).toBe("Hello");
		expect(received?.from?.id).toBe(user.payload.id);
		expect(received?.chat?.id).toBe(user.asChat.payload.id);
		expect(received?.chat?.type).toBe("private");
	});
});

describe("User actions", () => {
	it("should send a PM to bot", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });

		const msg = await user.sendMessage("Hello");

		expect(received).toBeDefined();
		expect(received?.text).toBe("Hello");
		expect(received?.from?.id).toBe(user.payload.id);
		expect(received?.chat?.type).toBe("private");
		expect(received?.chat?.id).toBe(user.payload.id);
		expect(msg.payload.text).toBe("Hello");
	});

	it("should send a message to a group", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });
		const group = env.createChat({ type: "group", title: "Test Group" });

		await user.sendMessage(group, "/start");

		expect(received).toBeDefined();
		expect(received?.text).toBe("/start");
		expect(received?.chat?.type).toBe("group");
		expect(received?.chat?.id).toBe(group.payload.id);
		expect(received?.from?.id).toBe(user.payload.id);
		expect(group.messages).toHaveLength(1);
	});

	it("should track messages in chat history", async () => {
		const bot = new Bot("test");
		bot.on("message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Chat" });

		await user.sendMessage(group, "First");
		await user.sendMessage(group, "Second");

		expect(group.messages).toHaveLength(2);
		expect(group.messages[0].payload.text).toBe("First");
		expect(group.messages[1].payload.text).toBe("Second");
	});

	it("should handle user joining a group", async () => {
		const bot = new Bot("test");
		const chatMemberUpdates: unknown[] = [];
		const messageUpdates: unknown[] = [];

		bot.on("chat_member", (ctx) => {
			chatMemberUpdates.push(ctx);
		});
		bot.on("message", (ctx) => {
			messageUpdates.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });
		const group = env.createChat({ type: "group", title: "Test Group" });

		await user.join(group);

		expect(group.members.has(user)).toBe(true);
		expect(group.messages).toHaveLength(1);
	});

	it("should handle user leaving a group", async () => {
		const bot = new Bot("test");
		bot.on("chat_member", () => {});
		bot.on("message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });
		const group = env.createChat({ type: "group", title: "Test Group" });

		await user.join(group);
		expect(group.members.has(user)).toBe(true);

		await user.leave(group);
		expect(group.members.has(user)).toBe(false);
		// join produces 1 service message, leave produces 1 more
		expect(group.messages).toHaveLength(2);
	});

	it("should handle callback query (button click)", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "callback_query"> | undefined;
		bot.on("callback_query", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });

		const cbQuery = await user.click("action:1");

		expect(received).toBeDefined();
		expect(received?.data).toBe("action:1");
		expect(cbQuery).toBeInstanceOf(CallbackQueryObject);
		expect(cbQuery.payload.data).toBe("action:1");
	});

	it("should handle callback query with message", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "callback_query"> | undefined;
		bot.on("callback_query", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });
		const msg = await user.sendMessage("Pick an option");

		await user.click("option:1", msg);

		expect(received).toBeDefined();
		expect(received?.data).toBe("option:1");
	});

	it("should throw when user is not attached to environment", async () => {
		const user = new UserObject({ first_name: "Detached" });

		expect(user.sendMessage("Hello")).rejects.toThrow(
			"UserObject is not attached to a TelegramTestEnvironment",
		);
	});
});

describe("API interception", () => {
	it("should capture bot API calls", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("Reply!");
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });

		await user.sendMessage("Hello");

		expect(env.apiCalls.length).toBeGreaterThan(0);
		expect(env.apiCalls[0].method).toBe("sendMessage");
	});

	it("should record API call params and response", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("Got it!");
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendMessage("Test");

		const call = env.apiCalls.find((c) => c.method === "sendMessage");
		expect(call).toBeDefined();
		expect(call?.params).toBeDefined();
		expect(call?.response).toBeDefined();
	});

	it("should start with empty apiCalls", () => {
		const bot = new Bot("test");
		const env = new TelegramTestEnvironment(bot);

		expect(env.apiCalls).toHaveLength(0);
	});
});

describe("State consistency", () => {
	it("should track multiple members in a group", async () => {
		const bot = new Bot("test");
		bot.on("chat_member", () => {});
		bot.on("message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const alice = env.createUser({ first_name: "Alice" });
		const bob = env.createUser({ first_name: "Bob" });
		const group = env.createChat({ type: "group", title: "Test Group" });

		await alice.join(group);
		await bob.join(group);

		expect(group.members.size).toBe(2);
		expect(group.members.has(alice)).toBe(true);
		expect(group.members.has(bob)).toBe(true);

		await alice.leave(group);

		expect(group.members.size).toBe(1);
		expect(group.members.has(alice)).toBe(false);
		expect(group.members.has(bob)).toBe(true);
	});

	it("should track messages across multiple chats", async () => {
		const bot = new Bot("test");
		bot.on("message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group1 = env.createChat({ type: "group", title: "Group 1" });
		const group2 = env.createChat({ type: "group", title: "Group 2" });

		await user.sendMessage(group1, "In group 1");
		await user.sendMessage(group2, "In group 2");
		await user.sendMessage(group1, "Again in group 1");

		expect(group1.messages).toHaveLength(2);
		expect(group2.messages).toHaveLength(1);
	});

	it("should track PM messages in user's private chat", async () => {
		const bot = new Bot("test");
		bot.on("message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendMessage("Hello");
		await user.sendMessage("World");

		expect(user.asChat.messages).toHaveLength(2);
	});
});

describe("Reactions", () => {
	it("should emit message_reaction update (simple form)", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });
		const msg = await user.sendMessage("Hello");

		await user.react("👍", msg);

		expect(received).toBeDefined();
		expect(received?.newReactions).toHaveLength(1);
		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "👍" });
		expect(received?.oldReactions).toHaveLength(0);
		expect(received?.user?.id).toBe(user.payload.id);
	});

	it("should emit message_reaction with multiple emojis (array form)", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react(["👍", "❤"], msg);

		expect(received?.newReactions).toHaveLength(2);
	});

	it("should auto-compute old_reaction when changing reaction", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react("👍", msg);       // sets memory: ["👍"]
		await user.react("❤", msg);        // old auto = ["👍"], new = ["❤"]

		expect(received?.oldReactions).toHaveLength(1);
		expect(received?.oldReactions[0]).toMatchObject({ type: "emoji", emoji: "👍" });
		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "❤" });
	});

	it("should trigger bot.reaction() handler (simple form)", async () => {
		const bot = new Bot("test");
		let triggered = false;
		bot.reaction("👍", async () => {
			triggered = true;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react("👍", msg);

		expect(triggered).toBe(true);
	});

	it("should not trigger bot.reaction() handler when removing a reaction", async () => {
		const bot = new Bot("test");
		let triggerCount = 0;
		bot.reaction("👍", async () => { triggerCount++; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react("👍", msg);  // triggers (adds 👍)
		await user.react([], msg);    // removes 👍 — should NOT trigger again

		expect(triggerCount).toBe(1);
	});

	it("should emit message_reaction via ReactObject builder", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react(new ReactObject().on(msg).add("👍"));

		expect(received?.newReactions).toHaveLength(1);
		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "👍" });
		expect(received?.user?.id).toBe(user.payload.id);
	});

	it("should support ReactObject with add and remove", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react(new ReactObject().on(msg).add("❤").remove("👍"));

		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "❤" });
		expect(received?.oldReactions[0]).toMatchObject({ type: "emoji", emoji: "👍" });
	});

	it("should support ReactObject with variadic add", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react(new ReactObject().on(msg).add("👍", "❤", "🔥"));

		expect(received?.newReactions).toHaveLength(3);
	});

	it("should trigger bot.reaction() handler via ReactObject", async () => {
		const bot = new Bot("test");
		let triggered = false;
		bot.reaction("🔥", async () => {
			triggered = true;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react(new ReactObject().on(msg).add("🔥"));

		expect(triggered).toBe(true);
	});

	it("should track reactions per user on the message", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const alice = env.createUser({ first_name: "Alice" });
		const bob = env.createUser({ first_name: "Bob" });
		const msg = await alice.sendMessage("Hello");

		await alice.react("👍", msg);
		await bob.react("❤", msg);

		expect(msg.reactions.get(alice.payload.id)).toEqual(["👍"]);
		expect(msg.reactions.get(bob.payload.id)).toEqual(["❤"]);
	});

	it("should update message.reactions when reaction changes", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react("👍", msg);
		expect(msg.reactions.get(user.payload.id)).toEqual(["👍"]);

		await user.react("🔥", msg);
		expect(msg.reactions.get(user.payload.id)).toEqual(["🔥"]);
	});

	it("should clear message.reactions when reacting with empty array", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react("👍", msg);
		expect(msg.reactions.get(user.payload.id)).toEqual(["👍"]);

		await user.react([], msg);
		expect(msg.reactions.has(user.payload.id)).toBe(false);
	});

	it("ReactObject auto-tracks via .on(msg)", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react(new ReactObject().on(msg).add("👍"));  // memory: ["👍"]
		await user.react(new ReactObject().on(msg).add("❤"));   // old auto = ["👍"]

		expect(received?.oldReactions[0]).toMatchObject({ type: "emoji", emoji: "👍" });
		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "❤" });
	});

	it("ReactObject explicit .remove() overrides auto-tracking", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.react("👍", msg);  // memory: ["👍"]
		// .remove("😢") explicitly sets old_reaction — auto-tracking is skipped
		await user.react(new ReactObject().on(msg).add("❤").remove("😢"));

		expect(received?.oldReactions[0]).toMatchObject({ type: "emoji", emoji: "😢" });
	});

	it("ReactObject.from() overrides user", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const alice = env.createUser({ first_name: "Alice" });
		const bob = env.createUser({ first_name: "Bob" });
		const msg = await alice.sendMessage("Hello");

		// react is sent through alice's environment but attributed to bob
		await alice.react(new ReactObject().from(bob).on(msg).add("👍"));

		expect(received?.user?.id).toBe(bob.payload.id);
	});
});

describe("Inline query", () => {
	it("should emit inline_query update", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "inline_query"> | undefined;
		bot.on("inline_query", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });

		const inlineQuery = await user.sendInlineQuery("search term");

		expect(received).toBeDefined();
		expect(received?.query).toBe("search term");
		expect(received?.from.id).toBe(user.payload.id);
		expect(inlineQuery).toBeInstanceOf(InlineQueryObject);
		expect(inlineQuery.payload.query).toBe("search term");
	});

	it("should pass offset option", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "inline_query"> | undefined;
		bot.on("inline_query", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendInlineQuery("term", { offset: "10" });

		expect(received?.offset).toBe("10");
	});

	it("should derive chat_type from a ChatObject", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Test Group" });

		const inlineQuery = await user.sendInlineQuery("query", group);

		expect(inlineQuery.payload.chat_type).toBe("group");
	});

	it("should derive chat_type supergroup from a ChatObject", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const supergroup = env.createChat({ type: "supergroup", title: "Super Group" });

		const inlineQuery = await user.sendInlineQuery("query", supergroup);

		expect(inlineQuery.payload.chat_type).toBe("supergroup");
	});

	it("should support offset with ChatObject", async () => {
		const bot = new Bot("test");
		let receivedOffset: string | undefined;
		bot.on("inline_query", (ctx) => {
			receivedOffset = ctx.offset;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group" });

		const inlineQuery = await user.sendInlineQuery("term", group, { offset: "5" });

		expect(inlineQuery.payload.chat_type).toBe("group");
		expect(receivedOffset).toBe("5");
	});

	it("should trigger bot.inlineQuery() handler", async () => {
		const bot = new Bot("test");
		let args: RegExpMatchArray | null = null;
		bot.inlineQuery(/search (.+)/, (ctx) => {
			args = ctx.args;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendInlineQuery("search cats");

		expect(args).not.toBeNull();
		expect(args![1]).toBe("cats");
	});

	it("should emit chosen_inline_result update", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "chosen_inline_result"> | undefined;
		bot.on("chosen_inline_result", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });

		const result = await user.chooseInlineResult("result-1", "search term");

		expect(received).toBeDefined();
		expect(received?.resultId).toBe("result-1");
		expect(received?.query).toBe("search term");
		expect(received?.from.id).toBe(user.payload.id);
		expect(result).toBeInstanceOf(ChosenInlineResultObject);
		expect(result.payload.result_id).toBe("result-1");
	});

	it("should pass inline_message_id option", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "chosen_inline_result"> | undefined;
		bot.on("chosen_inline_result", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.chooseInlineResult("id", "query", { inline_message_id: "msg-abc" });

		expect(received?.inlineMessageId).toBe("msg-abc");
	});
});

describe("Fluent scope API", () => {
	it("user.in(chat).sendMessage() sends to that chat", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });
		const group = env.createChat({ type: "group", title: "Test Group" });

		await user.in(group).sendMessage("Hello");

		expect(received?.text).toBe("Hello");
		expect(received?.chat?.id).toBe(group.payload.id);
	});

	it("user.in(chat).sendInlineQuery() derives chat_type", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const supergroup = env.createChat({ type: "supergroup" });

		const q = await user.in(supergroup).sendInlineQuery("cats");

		expect(q.payload.chat_type).toBe("supergroup");
		expect(q.payload.query).toBe("cats");
	});

	it("user.in(chat).sendInlineQuery() forwards offset", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const group = env.createChat({ type: "group" });

		const q = await user.in(group).sendInlineQuery("dogs", { offset: "20" });

		expect(q.payload.offset).toBe("20");
	});

	it("user.in(chat).join() joins that chat", async () => {
		const bot = new Bot("test");
		bot.on("chat_member", () => {});
		bot.on("message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group" });

		await user.in(group).join();

		expect(group.members.has(user)).toBe(true);
	});

	it("user.in(chat).leave() leaves that chat", async () => {
		const bot = new Bot("test");
		bot.on("chat_member", () => {});
		bot.on("message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group" });

		await user.in(group).join();
		await user.in(group).leave();

		expect(group.members.has(user)).toBe(false);
	});

	it("user.on(msg).react() reacts to that message", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.on(msg).react("👍");

		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "👍" });
	});

	it("user.on(msg).react() auto-tracks old reaction via message state", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.on("message_reaction", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		await user.on(msg).react("👍");    // memory: ["👍"]
		await user.on(msg).react("❤");     // old auto = ["👍"], new = ["❤"]

		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "❤" });
		expect(received?.oldReactions[0]).toMatchObject({ type: "emoji", emoji: "👍" });
	});

	it("user.on(msg).click() clicks inline button on that message", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "callback_query"> | undefined;
		bot.on("callback_query", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Pick one");

		await user.on(msg).click("action:1");

		expect(received?.data).toBe("action:1");
	});

	it("user.in(chat).on(msg).react() chains correctly", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message_reaction"> | undefined;
		bot.reaction("🔥", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group" });
		const msg = await user.sendMessage(group, "Hello group");

		await user.in(group).on(msg).react("🔥");

		expect(received).toBeDefined();
		expect(received?.newReactions[0]).toMatchObject({ type: "emoji", emoji: "🔥" });
	});

	it("user.in(chat).on(msg).click() chains correctly", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "callback_query"> | undefined;
		bot.on("callback_query", (ctx) => { received = ctx; });

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group" });
		const msg = await user.sendMessage(group, "Choose:");

		await user.in(group).on(msg).click("choice:A");

		expect(received?.data).toBe("choice:A");
	});
});

describe("onApi / offApi", () => {
	it("should override response with a static value", async () => {
		const bot = new Bot("test");
		let response: unknown;
		bot.on("message", async (ctx) => {
			response = await ctx.send("Hi");
		});

		const env = new TelegramTestEnvironment(bot);
		env.onApi("sendMessage", {
			message_id: 42,
			date: 0,
			chat: { id: 1, type: "private" as const },
			text: "mocked",
		});

		const user = env.createUser();
		await user.sendMessage("Hello");

		expect(env.apiCalls[0].response).toEqual(
			expect.objectContaining({ message_id: 42, text: "mocked" }),
		);
	});

	it("should override response with a dynamic handler", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("Hi");
		});

		const env = new TelegramTestEnvironment(bot);
		env.onApi("sendMessage", (params) => ({
			message_id: 100,
			date: 0,
			chat: { id: Number(params.chat_id), type: "private" as const },
			text: `echo: ${params.text}`,
		}));

		const user = env.createUser();
		await user.sendMessage("Hello");

		const call = env.apiCalls.find((c) => c.method === "sendMessage");
		expect((call?.response as { text: string }).text).toBe("echo: Hi");
	});

	it("should reject with TelegramError when handler returns apiError", async () => {
		const bot = new Bot("test");
		let caughtError: unknown;
		bot.on("message", async (ctx) => {
			try {
				await ctx.send("Hi");
			} catch (error) {
				caughtError = error;
			}
		});

		const env = new TelegramTestEnvironment(bot);
		env.onApi(
			"sendMessage",
			apiError(403, "Forbidden: bot was blocked by the user"),
		);

		const user = env.createUser();
		await user.sendMessage("Hello");

		expect(caughtError).toBeInstanceOf(TelegramError);
		expect((caughtError as TelegramError<"sendMessage">).code).toBe(403);
		expect((caughtError as TelegramError<"sendMessage">).message).toBe(
			"Forbidden: bot was blocked by the user",
		);
	});

	it("should reject with correct method in TelegramError", async () => {
		const bot = new Bot("test");
		let caughtError: unknown;
		bot.on("message", async (ctx) => {
			try {
				await ctx.send("Hi");
			} catch (error) {
				caughtError = error;
			}
		});

		const env = new TelegramTestEnvironment(bot);
		env.onApi(
			"sendMessage",
			apiError(403, "Forbidden"),
		);

		const user = env.createUser();
		await user.sendMessage("Hello");

		expect((caughtError as TelegramError<"sendMessage">).method).toBe("sendMessage");
	});

	it("should support conditional error/success in dynamic handler", async () => {
		const bot = new Bot("test");
		const results: unknown[] = [];
		bot.on("message", async (ctx) => {
			try {
				const result = await ctx.send("Hi");
				results.push({ ok: true, result });
			} catch (error) {
				results.push({ ok: false, error });
			}
		});

		const env = new TelegramTestEnvironment(bot);
		const blockedChatId = 999;

		env.onApi("sendMessage", (params) => {
			if (params.chat_id === blockedChatId) {
				return apiError(403, "Forbidden: bot was blocked by the user");
			}
			return {
				message_id: 1,
				date: 0,
				chat: { id: Number(params.chat_id), type: "private" as const },
				text: String(params.text),
			};
		});

		const user = env.createUser();
		await user.sendMessage("Hello"); // succeeds — user's chat id !== 999

		expect(results).toHaveLength(1);
		expect((results[0] as { ok: boolean }).ok).toBe(true);
	});

	it("should support apiError with retry_after parameters", async () => {
		const bot = new Bot("test");
		let caughtError: unknown;
		bot.on("message", async (ctx) => {
			try {
				await ctx.send("Hi");
			} catch (error) {
				caughtError = error;
			}
		});

		const env = new TelegramTestEnvironment(bot);
		env.onApi(
			"sendMessage",
			apiError(429, "Too Many Requests", { retry_after: 30 }),
		);

		const user = env.createUser();
		await user.sendMessage("Hello");

		expect(caughtError).toBeInstanceOf(TelegramError);
		expect((caughtError as TelegramError<"sendMessage">).code).toBe(429);
		expect((caughtError as TelegramError<"sendMessage">).payload?.retry_after).toBe(30);
	});

	it("should reset specific handler with offApi(method)", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("Hi");
		});

		const env = new TelegramTestEnvironment(bot);
		env.onApi("sendMessage", { message_id: 42, date: 0, chat: { id: 1, type: "private" as const }, text: "custom" });

		const user = env.createUser();
		await user.sendMessage("Hello");
		expect((env.apiCalls[0].response as { message_id: number }).message_id).toBe(42);

		env.offApi("sendMessage");
		await user.sendMessage("Hello again");

		// After offApi, falls back to default mock (incrementing message_id)
		const secondCall = env.apiCalls.find(
			(c, i) => i > 0 && c.method === "sendMessage",
		);
		expect((secondCall?.response as { message_id: number }).message_id).not.toBe(42);
	});

	it("should reset all handlers with offApi()", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("Hi");
		});

		const env = new TelegramTestEnvironment(bot);

		// Set custom handler that returns a known message_id
		env.onApi("sendMessage", {
			message_id: 777,
			date: 0,
			chat: { id: 1, type: "private" as const },
			text: "custom",
		});

		env.offApi();

		const user = env.createUser();
		await user.sendMessage("Hello");

		// After offApi(), default mock is used — message_id won't be 777
		const call = env.apiCalls.find((c) => c.method === "sendMessage");
		expect((call?.response as { message_id: number }).message_id).not.toBe(
			777,
		);
	});

	it("should record apiError responses in apiCalls", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			try {
				await ctx.send("Hi");
			} catch {}
		});

		const env = new TelegramTestEnvironment(bot);
		env.onApi("sendMessage", apiError(403, "Forbidden"));

		const user = env.createUser();
		await user.sendMessage("Hello");

		const call = env.apiCalls.find((c) => c.method === "sendMessage");
		expect(call).toBeDefined();
		expect(call?.response).toBeInstanceOf(TelegramError);
	});
});
