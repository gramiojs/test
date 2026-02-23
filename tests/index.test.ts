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

describe("New media send methods", () => {
	it("sendAudio() emits message update with audio attachment", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Alice" });

		const msg = await user.sendAudio();

		expect(received).toBeDefined();
		expect(received?.audio).toBeDefined();
		expect(msg.payload.audio).toBeDefined();
		expect(msg.payload.audio?.duration).toBe(30);
	});

	it("sendAudio() to a group chat routes to that chat", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Music Room" });

		await user.sendAudio(group);

		expect(received?.chat?.id).toBe(group.payload.id);
		expect(received?.audio).toBeDefined();
	});

	it("sendAnimation() emits message update with animation attachment", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		const msg = await user.sendAnimation();

		expect(received).toBeDefined();
		expect(received?.animation).toBeDefined();
		expect(msg.payload.animation?.width).toBe(480);
		expect(msg.payload.animation?.height).toBe(270);
		expect(msg.payload.animation?.duration).toBe(3);
	});

	it("sendAnimation() accepts a caption via MediaOptions", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendAnimation({ caption: "Cool GIF" });

		expect(received?.caption).toBe("Cool GIF");
		expect(received?.animation).toBeDefined();
	});

	it("sendVideoNote() emits message update with video_note attachment", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		const msg = await user.sendVideoNote();

		expect(received).toBeDefined();
		expect(received?.videoNote).toBeDefined();
		expect(msg.payload.video_note?.length).toBe(240);
		expect(msg.payload.video_note?.duration).toBe(10);
	});

	it("sendVideoNote() to a group chat routes to that chat", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Video Notes" });

		await user.sendVideoNote(group);

		expect(received?.chat?.id).toBe(group.payload.id);
		expect(received?.videoNote).toBeDefined();
	});
});

describe("user.editMessage()", () => {
	it("mutates msg.payload.text and emits edited_message", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "edited_message"> | undefined;
		bot.on("edited_message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Original text");

		await user.editMessage(msg, "Edited text");

		expect(msg.payload.text).toBe("Edited text");
		expect(received).toBeDefined();
		expect(received?.text).toBe("Edited text");
	});

	it("sets edit_date on the message payload", async () => {
		const bot = new Bot("test");
		bot.on("edited_message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Hello");

		const before = Math.floor(Date.now() / 1000);
		await user.editMessage(msg, "Updated");
		const after = Math.floor(Date.now() / 1000);

		expect(msg.payload.edit_date).toBeGreaterThanOrEqual(before);
		expect(msg.payload.edit_date).toBeLessThanOrEqual(after);
	});

	it("returns the same MessageObject (mutated in place)", async () => {
		const bot = new Bot("test");
		bot.on("edited_message", () => {});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("First version");

		const result = await user.editMessage(msg, "Second version");

		expect(result).toBe(msg);
	});

	it("emits edited_message with updatedAt accessible from context", async () => {
		const bot = new Bot("test");
		let updatedAtInCtx: number | undefined;
		bot.on("edited_message", (ctx) => {
			updatedAtInCtx = ctx.updatedAt;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Original");

		await user.editMessage(msg, "New text");

		expect(updatedAtInCtx).toBeDefined();
		expect(typeof updatedAtInCtx).toBe("number");
	});
});

describe("user.forwardMessage()", () => {
	it("emits a new message update with forward_origin set", async () => {
		const bot = new Bot("test");
		const messages: ContextType<Bot, "message">[] = [];
		bot.on("message", (ctx) => {
			messages.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const alice = env.createUser({ first_name: "Alice" });
		const bob = env.createUser({ first_name: "Bob" });
		const original = await alice.sendMessage("Hello from Alice");

		await bob.forwardMessage(original);

		const forwarded = messages[messages.length - 1];
		expect(forwarded.forwardOrigin).toBeDefined();
		expect(forwarded.text).toBe("Hello from Alice");
	});

	it("forward_origin.sender_user matches original sender", async () => {
		const bot = new Bot("test");
		const messages: ContextType<Bot, "message">[] = [];
		bot.on("message", (ctx) => {
			messages.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const alice = env.createUser({ first_name: "Alice" });
		const bob = env.createUser({ first_name: "Bob" });
		const original = await alice.sendMessage("Forward me");

		await bob.forwardMessage(original);

		const forwarded = messages[messages.length - 1];
		const origin = forwarded.payload.forward_origin as {
			type: string;
			sender_user: { id: number };
		};
		expect(origin.type).toBe("user");
		expect(origin.sender_user.id).toBe(alice.payload.id);
	});

	it("forwards to toChat when provided", async () => {
		const bot = new Bot("test");
		const messages: ContextType<Bot, "message">[] = [];
		bot.on("message", (ctx) => {
			messages.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const alice = env.createUser({ first_name: "Alice" });
		const group = env.createChat({ type: "group", title: "Fwd Group" });
		const original = await alice.sendMessage("For forwarding");

		await alice.forwardMessage(original, group);

		const forwarded = messages[messages.length - 1];
		expect(forwarded.chat?.id).toBe(group.payload.id);
	});

	it("defaults to forwarder's PM chat when toChat is omitted", async () => {
		const bot = new Bot("test");
		const messages: ContextType<Bot, "message">[] = [];
		bot.on("message", (ctx) => {
			messages.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const alice = env.createUser({ first_name: "Alice" });
		const bob = env.createUser({ first_name: "Bob" });
		const original = await alice.sendMessage("Hello");

		await bob.forwardMessage(original);

		const forwarded = messages[messages.length - 1];
		expect(forwarded.chat?.id).toBe(bob.asChat.payload.id);
		expect(forwarded.chat?.type).toBe("private");
	});
});

describe("user.sendMediaGroup()", () => {
	it("emits one message update per item and returns all MessageObjects", async () => {
		const bot = new Bot("test");
		const updates: ContextType<Bot, "message">[] = [];
		bot.on("message", (ctx) => {
			updates.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		const results = await user.sendMediaGroup([
			{
				photo: [
					{ file_id: "f1", file_unique_id: "u1", width: 100, height: 100 },
				],
			},
			{
				photo: [
					{ file_id: "f2", file_unique_id: "u2", width: 100, height: 100 },
				],
			},
			{
				photo: [
					{ file_id: "f3", file_unique_id: "u3", width: 100, height: 100 },
				],
			},
		]);

		expect(results).toHaveLength(3);
		expect(updates).toHaveLength(3);
	});

	it("all messages in the group share the same media_group_id", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();

		const results = await user.sendMediaGroup([
			{
				photo: [
					{ file_id: "f1", file_unique_id: "u1", width: 100, height: 100 },
				],
			},
			{
				photo: [
					{ file_id: "f2", file_unique_id: "u2", width: 100, height: 100 },
				],
			},
		]);

		expect(results[0].payload.media_group_id).toBeDefined();
		expect(results[0].payload.media_group_id).toBe(
			results[1].payload.media_group_id,
		);
	});

	it("sendMediaGroup() with a leading ChatObject routes all items to that chat", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Album Group" });

		const results = await user.sendMediaGroup(group, [
			{
				photo: [
					{ file_id: "f1", file_unique_id: "u1", width: 100, height: 100 },
				],
			},
			{
				photo: [
					{ file_id: "f2", file_unique_id: "u2", width: 100, height: 100 },
				],
			},
		]);

		for (const msg of results) {
			expect(msg.payload.chat?.id).toBe(group.payload.id);
		}
	});
});

describe("user.pinMessage()", () => {
	it("emits a message update with pinned_message set", async () => {
		const bot = new Bot("test");
		const messages: ContextType<Bot, "pinned_message">[] = [];
		// GramIO routes pinned_message service messages to "pinned_message" event
		bot.on("pinned_message", (ctx) => {
			messages.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const original = await user.sendMessage("Pin me!");

		await user.pinMessage(original);

		const pinMsg = messages[messages.length - 1];
		expect(pinMsg.pinnedMessage).toBeDefined();
		// @ts-expect-error inaccessible type
		expect(pinMsg.pinnedMessage?.text).toBe("Pin me!");
	});

	it("pins in the specified inChat when provided", async () => {
		const bot = new Bot("test");
		const messages: ContextType<Bot, "pinned_message">[] = [];
		bot.on("pinned_message", (ctx) => {
			messages.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Pin Group" });
		const original = await user.sendMessage("Hello");

		await user.pinMessage(original, group);

		const pinMsg = messages[messages.length - 1];
		expect(pinMsg.chat?.id).toBe(group.payload.id);
		expect(pinMsg.pinnedMessage).toBeDefined();
	});

	it("defaults to message._chat when inChat is omitted", async () => {
		const bot = new Bot("test");
		const messages: ContextType<Bot, "pinned_message">[] = [];
		bot.on("pinned_message", (ctx) => {
			messages.push(ctx);
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Chat" });
		const original = await user.sendMessage(group, "Original");

		await user.pinMessage(original);

		const pinMsg = messages[messages.length - 1];
		expect(pinMsg.chat?.id).toBe(group.payload.id);
	});
});

describe("user.on(msg).clickByText()", () => {
	it("finds an inline button by text and emits callback_query", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "callback_query"> | undefined;
		bot.on("callback_query", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Choose:");

		msg.payload.reply_markup = {
			inline_keyboard: [
				[{ text: "Option A", callback_data: "opt:a" }],
				[{ text: "Option B", callback_data: "opt:b" }],
			],
		};

		await user.on(msg).clickByText("Option B");

		expect(received).toBeDefined();
		expect(received?.data).toBe("opt:b");
	});

	it("finds the correct button in a multi-button row", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "callback_query"> | undefined;
		bot.on("callback_query", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const msg = await user.sendMessage("Multi-button row:");

		msg.payload.reply_markup = {
			inline_keyboard: [
				[
					{ text: "Yes", callback_data: "answer:yes" },
					{ text: "No", callback_data: "answer:no" },
					{ text: "Maybe", callback_data: "answer:maybe" },
				],
			],
		};

		await user.on(msg).clickByText("No");

		expect(received?.data).toBe("answer:no");
	});

	it("throws when the message has no inline keyboard", () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const msg = new MessageObject().from(user).text("No buttons");

		expect(() => user.on(msg).clickByText("Anything")).toThrow(
			"Message has no inline keyboard",
		);
	});

	it("throws when no button matches the given text", () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const msg = new MessageObject().from(user).text("Pick:");

		msg.payload.reply_markup = {
			inline_keyboard: [[{ text: "Existing", callback_data: "data:1" }]],
		};

		expect(() => user.on(msg).clickByText("Missing")).toThrow(
			'No inline button with text "Missing" found',
		);
	});
});

describe("ChatObject.post()", () => {
	it("emits a channel_post update", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "channel_post"> | undefined;
		bot.on("channel_post", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const channel = env.createChat({ type: "channel", title: "My Channel" });

		await channel.post("Hello from channel");

		expect(received).toBeDefined();
		expect(received?.text).toBe("Hello from channel");
	});

	it("channel_post has no from field (anonymous channel post)", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "channel_post"> | undefined;
		bot.on("channel_post", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const channel = env.createChat({ type: "channel", title: "Anon Channel" });

		await channel.post("Anonymous post");

		expect(received?.from).toBeUndefined();
	});

	it("tracks posted messages in chat.messages", async () => {
		const bot = new Bot("test");
		bot.on("channel_post", () => {});

		const env = new TelegramTestEnvironment(bot);
		const channel = env.createChat({ type: "channel", title: "News" });

		await channel.post("First post");
		await channel.post("Second post");

		expect(channel.messages).toHaveLength(2);
		expect(channel.messages[0].payload.text).toBe("First post");
		expect(channel.messages[1].payload.text).toBe("Second post");
	});

	it("throws when ChatObject is not attached to an environment", async () => {
		const channel = new ChatObject({ type: "channel", title: "Detached" });

		expect(channel.post("Will fail")).rejects.toThrow(
			"ChatObject is not attached to a TelegramTestEnvironment",
		);
	});
});

describe("env.clearApiCalls() / env.lastApiCall()", () => {
	it("clearApiCalls() empties the apiCalls array", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("Reply");
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendMessage("Hello");
		expect(env.apiCalls.length).toBeGreaterThan(0);

		env.clearApiCalls();

		expect(env.apiCalls).toHaveLength(0);
	});

	it("clearApiCalls() allows fresh recording after clearing", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("Hi");
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendMessage("First");
		env.clearApiCalls();
		await user.sendMessage("Second");

		expect(env.apiCalls.length).toBeGreaterThan(0);
		const textParams = env.apiCalls.map(
			(c) => (c.params as { text?: string }).text,
		);
		expect(textParams).not.toContain("First");
	});

	it("lastApiCall() returns the most recent call for a method", async () => {
		const bot = new Bot("test");
		bot.on("message", async (ctx) => {
			await ctx.send("First reply");
			await ctx.send("Second reply");
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();

		await user.sendMessage("Trigger");

		const last = env.lastApiCall("sendMessage");
		expect(last).toBeDefined();
		expect((last?.params as { text?: string }).text).toBe("Second reply");
	});

	it("lastApiCall() returns undefined when no call for method was recorded", () => {
		const env = new TelegramTestEnvironment(new Bot("test"));

		expect(env.lastApiCall("deleteMessage")).toBeUndefined();
	});
});

describe("UserInChatScope — new media methods", () => {
	it("user.in(chat).sendAudio() routes to the scoped chat", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Audio Room" });

		await user.in(group).sendAudio();

		expect(received?.chat?.id).toBe(group.payload.id);
		expect(received?.audio).toBeDefined();
	});

	it("user.in(chat).sendAnimation() routes to the scoped chat and supports MediaOptions", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "GIF Room" });

		await user.in(group).sendAnimation({ caption: "Animated!" });

		expect(received?.chat?.id).toBe(group.payload.id);
		expect(received?.animation).toBeDefined();
		expect(received?.caption).toBe("Animated!");
	});

	it("user.in(chat).sendVideoNote() routes to the scoped chat", async () => {
		const bot = new Bot("test");
		let received: ContextType<Bot, "message"> | undefined;
		bot.on("message", (ctx) => {
			received = ctx;
		});

		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser();
		const group = env.createChat({ type: "group", title: "Circle Videos" });

		await user.in(group).sendVideoNote();

		expect(received?.chat?.id).toBe(group.payload.id);
		expect(received?.videoNote).toBeDefined();
	});
});
