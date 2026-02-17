# @gramio/test

[![npm](https://img.shields.io/npm/v/@gramio/test?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/test)
[![npm downloads](https://img.shields.io/npm/dw/@gramio/test?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/test)
[![JSR](https://jsr.io/badges/@gramio/test)](https://jsr.io/@gramio/test)
[![JSR Score](https://jsr.io/badges/@gramio/test/score)](https://jsr.io/@gramio/test)

An event-driven test framework for bots built with [GramIO](https://gramio.dev). Users are the primary actors — they send messages, join/leave chats, click inline buttons — and the framework manages in-memory state and emits the correct Telegram updates to the bot under test.

## Installation

```bash
bun add -d @gramio/test
```

## Quick Start

```ts
import { describe, expect, it } from "bun:test";
import { Bot } from "gramio";
import { TelegramTestEnvironment } from "@gramio/test";

describe("My bot", () => {
    it("should reply to /start", async () => {
        const bot = new Bot("test");
        bot.command("start", (ctx) => ctx.send("Welcome!"));

        const env = new TelegramTestEnvironment(bot);
        const user = env.createUser({ first_name: "Alice" });

        await user.sendMessage("/start");

        expect(env.apiCalls[0].method).toBe("sendMessage");
    });
});
```

## API

### `TelegramTestEnvironment`

The central orchestrator. Wraps a GramIO `Bot`, intercepts all outgoing API calls, and provides factories for users and chats.

```ts
const bot = new Bot("test");
const env = new TelegramTestEnvironment(bot);
```

- **`env.createUser(payload?)`** — creates a `UserObject` linked to the environment
- **`env.createChat(payload?)`** — creates a `ChatObject` (group, supergroup, channel, etc.)
- **`env.emitUpdate(update)`** — sends a raw `TelegramUpdate` or `MessageObject` to the bot
- **`env.onApi(method, handler)`** — override the response for a specific API method (see [Mocking API Responses](#mocking-api-responses))
- **`env.offApi(method?)`** — remove a custom handler (or all handlers if no method given)
- **`env.apiCalls`** — array of `{ method, params, response }` recording every API call the bot made
- **`env.users`** / **`env.chats`** — all created users and chats

### `UserObject` — the primary actor

Users drive the test scenario. Create them via `env.createUser()`:

```ts
const user = env.createUser({ first_name: "Alice" });
```

#### `user.sendMessage(text)` — send a PM to the bot

```ts
const msg = await user.sendMessage("Hello");
```

#### `user.sendMessage(chat, text)` — send a message to a group

```ts
const group = env.createChat({ type: "group", title: "Test Group" });
await user.sendMessage(group, "/start");
```

#### `user.join(chat)` / `user.leave(chat)` — join or leave a group

Emits a `chat_member` update and a service message (`new_chat_members` / `left_chat_member`). Updates `chat.members` set.

```ts
await user.join(group);
expect(group.members.has(user)).toBe(true);

await user.leave(group);
expect(group.members.has(user)).toBe(false);
```

#### `user.in(chat)` — scope to a chat

Returns a `UserInChatScope` with the chat pre-bound. All methods on the scope delegate to the underlying user.

```ts
const group = env.createChat({ type: "group" });

await user.in(group).sendMessage("Hello");
await user.in(group).sendInlineQuery("cats");          // chat_type: "group"
await user.in(group).sendInlineQuery("cats", { offset: "10" });
await user.in(group).join();
await user.in(group).leave();
```

Chain `.on(msg)` to reach the message scope:

```ts
const msg = await user.sendMessage(group, "Pick one");
await user.in(group).on(msg).react("👍");
await user.in(group).on(msg).click("choice:A");
```

#### `user.on(msg)` — scope to a message

Returns a `UserOnMessageScope` with the message pre-bound. Useful when you already have a message and don't need to re-state the chat.

```ts
const msg = await user.sendMessage("Nice bot!");
await user.on(msg).react("👍");
await user.on(msg).react("❤", { oldReactions: ["👍"] });
await user.on(msg).click("action:1");
```

#### `user.click(callbackData, message?)` — click an inline button

Emits a `callback_query` update.

```ts
const msg = await user.sendMessage("Pick an option");
await user.click("option:1", msg);
```

#### `user.react(emojis, message?)` — react to a message

Emits a `message_reaction` update. Works with `bot.reaction()` handlers.

**Reaction state is tracked automatically on each `MessageObject`** — you never need to declare what the user previously had. The `old_reaction` field of the emitted update is filled in from the message's in-memory state.

```ts
const msg = await user.sendMessage("Nice bot!");

// Add a reaction (old: [], new: ["👍"])
await user.react("👍", msg);

// Change reaction — old is auto-computed from memory (old: ["👍"], new: ["❤"])
await user.react("❤", msg);

// React with multiple emojis
await user.react(["👍", "🔥"], msg);

// Remove all reactions — pass an empty array (old: auto, new: [])
await user.react([], msg);
```

The current state is accessible on the message object:

```ts
msg.reactions.get(user.payload.id); // e.g. ["❤"]
msg.reactions.has(user.payload.id); // false after react([])
```

Multiple users can react independently — each user's state is tracked separately:

```ts
await alice.react("👍", msg);
await bob.react("❤", msg);

msg.reactions.get(alice.payload.id); // ["👍"]
msg.reactions.get(bob.payload.id);   // ["❤"]
```

**Using `ReactObject` for full control:**

```ts
// old_reaction is also auto-tracked when .on(msg) is used
await user.react(new ReactObject().on(msg).add("👍", "🔥"));

// Explicit .remove() overrides auto-tracking for old_reaction
await user.react(new ReactObject().on(msg).add("❤").remove("😢"));
```

**Via scoped API — same auto-tracking applies:**

```ts
await user.on(msg).react("👍");   // memory: ["👍"]
await user.on(msg).react("❤");    // old auto = ["👍"], new = ["❤"]
await user.on(msg).react([]);     // remove all, old auto = ["❤"]
```

#### `user.sendInlineQuery(query, chatOrOptions?, options?)` — send an inline query

Emits an `inline_query` update. Works with `bot.inlineQuery()` handlers. Pass a `ChatObject` as the second argument to automatically set `chat_type`.

```ts
// Simple — no chat context
const q = await user.sendInlineQuery("search cats");

// With chat — chat_type is derived automatically
const group = env.createChat({ type: "group" });
const q = await user.sendInlineQuery("search cats", group);

// With options only
await user.sendInlineQuery("search dogs", { offset: "10" });

// With chat + offset
await user.sendInlineQuery("search dogs", group, { offset: "10" });
```

#### `user.chooseInlineResult(resultId, query, options?)` — choose an inline result

Emits a `chosen_inline_result` update. Works with `bot.chosenInlineResult()` handlers.

```ts
await user.chooseInlineResult("result-1", "search cats");

// With inline_message_id for inline-mode messages
await user.chooseInlineResult("result-1", "search cats", { inline_message_id: "abc" });
```

### `ChatObject`

Wraps `TelegramChat` with in-memory state tracking:

- **`chat.members`** — `Set<UserObject>` of current members
- **`chat.messages`** — `MessageObject[]` history of all messages in the chat

### `MessageObject`

Wraps `TelegramMessage` with builder methods:

```ts
const message = new MessageObject({ text: "Hello" })
    .from(user)
    .chat(group);
```

### `CallbackQueryObject`

Wraps `TelegramCallbackQuery` with builder methods:

```ts
const cbQuery = new CallbackQueryObject()
    .from(user)
    .data("action:1")
    .message(msg);
```

### `ReactObject`

Chainable builder for `message_reaction` updates. Use with `user.react()` or emit directly via `env.emitUpdate()`.

| Method | Description |
|--------|-------------|
| `.from(user)` | Set the user who reacted (auto-filled by `user.react()`) |
| `.on(message)` | Attach to a message and infer the chat |
| `.inChat(chat)` | Override the chat explicitly |
| `.add(...emojis)` | Emojis being added (`new_reaction`) |
| `.remove(...emojis)` | Emojis being removed (`old_reaction`) |

```ts
const reaction = new ReactObject()
    .on(msg)
    .add("👍", "🔥")
    .remove("😢");

await user.react(reaction);
```

### `InlineQueryObject`

Wraps `TelegramInlineQuery` with builder methods:

```ts
const inlineQuery = new InlineQueryObject()
    .from(user)
    .query("search cats")
    .offset("0");
```

### `ChosenInlineResultObject`

Wraps `TelegramChosenInlineResult` with builder methods:

```ts
const result = new ChosenInlineResultObject()
    .from(user)
    .resultId("result-1")
    .query("search cats");
```

## Inspecting Bot API Calls

The environment intercepts all outgoing API calls (no real HTTP requests are made) and records them:

```ts
const bot = new Bot("test");
bot.on("message", async (ctx) => {
    await ctx.send("Reply!");
});

const env = new TelegramTestEnvironment(bot);
const user = env.createUser();

await user.sendMessage("Hello");

expect(env.apiCalls).toHaveLength(1);
expect(env.apiCalls[0].method).toBe("sendMessage");
expect(env.apiCalls[0].params.text).toBe("Reply!");
```

## Mocking API Responses

Use `env.onApi()` to control what the bot receives from the Telegram API. Accepts a static value or a dynamic handler function:

```ts
// Static response
env.onApi("getMe", { id: 1, is_bot: true, first_name: "TestBot" });

// Dynamic response based on params
env.onApi("sendMessage", (params) => ({
    message_id: 1,
    date: Date.now(),
    chat: { id: params.chat_id, type: "private" },
    text: params.text,
}));
```

### Simulating Errors

Use `apiError()` to create a `TelegramError` that the bot will receive as a rejected promise — matching exactly how real Telegram API errors work in GramIO:

```ts
import { TelegramTestEnvironment, apiError } from "@gramio/test";

// Bot is blocked by user
env.onApi("sendMessage", apiError(403, "Forbidden: bot was blocked by the user"));

// Rate limiting
env.onApi("sendMessage", apiError(429, "Too Many Requests", { retry_after: 30 }));

// Conditional — error for some chats, success for others
env.onApi("sendMessage", (params) => {
    if (params.chat_id === blockedUserId) {
        return apiError(403, "Forbidden: bot was blocked by the user");
    }
    return { message_id: 1, date: Date.now(), chat: { id: params.chat_id, type: "private" }, text: params.text };
});
```

### Resetting

```ts
env.offApi("sendMessage"); // reset specific method
env.offApi();              // reset all overrides
```
