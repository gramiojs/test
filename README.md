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

#### `user.click(callbackData, message?)` — click an inline button

Emits a `callback_query` update.

```ts
const msg = await user.sendMessage("Pick an option");
await user.click("option:1", msg);
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
