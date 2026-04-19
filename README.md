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
import { Bot, format, bold } from "gramio";
import { TelegramTestEnvironment } from "@gramio/test";

describe("My bot", () => {
    it("should reply to /start", async () => {
        const bot = new Bot("test");
        bot.command("start", (ctx) => ctx.send("Welcome!"));

        const env = new TelegramTestEnvironment(bot);
        const user = env.createUser({ first_name: "Alice" });

        await user.sendCommand("start");

        expect(env.apiCalls[0].method).toBe("sendMessage");
    });

    it("should handle formatted messages", async () => {
        const bot = new Bot("test");
        bot.on("message", (ctx) => ctx.send("Got it!"));

        const env = new TelegramTestEnvironment(bot);
        const user = env.createUser();

        // FormattableString from gramio's format`` tag — text and entities extracted automatically
        await user.sendMessage(format`Check out ${bold("this")} link`);
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
- **`env.apiCalls`** — array of `{ method, params, response }` recording every API call the bot made. Builder instances (e.g. `InlineKeyboard`) in `params.reply_markup` and `params.results[].reply_markup` are unwrapped to plain JSON before recording, so you never need to `JSON.parse(JSON.stringify(...))` to assert on them.
- **`env.clearApiCalls()`** — empties the `apiCalls` array and drops the bubble cache (useful between logical test phases)
- **`env.lastApiCall(method)`** — returns the most recent recorded call for `method`, or `undefined` if none
- **`env.filterApiCalls(method)`** — returns all recorded calls for `method` with typed params and response
- **`env.lastBotMessage(opts?)`** — returns a `MessageObject` mirror of the bot's most recent `sendMessage`, or `undefined`. Pass `{ chat }` to scope to a specific chat. The returned bubble is automatically kept in sync with subsequent `editMessageText` / `editMessageCaption` / `editMessageReplyMarkup` calls — even on references captured before the edit — so `user.on(bubble).clickByText(...)` always sees current buttons. Repeated calls return the same instance for the same `(chat_id, message_id)`.
- **`env.botMessage(chatId, messageId)`** — look up a specific bubble by id, or `undefined` if the bot never sent that message
- **`env.users`** / **`env.chats`** — all created users and chats

### `UserObject` — the primary actor

Users drive the test scenario. Create them via `env.createUser()`:

```ts
const user = env.createUser({ first_name: "Alice" });
```

#### `user.sendMessage(text, options?)` — send a PM to the bot

Accepts a plain string or a `format\`\`` `FormattableString` (text and entities are extracted automatically). Pass `MessageOptions` to attach extra entities or set a reply.

```ts
import { format, bold, italic } from "gramio";

const msg = await user.sendMessage("Hello");

// FormattableString — entities are auto-extracted
await user.sendMessage(format`Hello ${bold("world")}`);

// With options
await user.sendMessage("reply here", { reply_to: msg });
await user.sendMessage(format`${italic("important")}`, { reply_to: msg });
```

```ts
interface MessageOptions {
    entities?: TelegramMessageEntity[]; // extra entities to merge
    reply_to?: MessageObject;           // sets reply_to_message
}
```

#### `user.sendMessage(chat, text, options?)` — send a message to a group

```ts
const group = env.createChat({ type: "group", title: "Test Group" });
await user.sendMessage(group, "Hello group");
await user.sendMessage(group, format`${bold("Bold")} in group`);
```

#### `user.sendReply(message, text)` — reply to a message

Shortcut that automatically sets `reply_to_message` and targets the same chat the original message was in.

```ts
const msg = await user.sendMessage("Hello");
await user.sendReply(msg, "Nice to meet you!");
await user.sendReply(msg, format`Thanks ${bold("a lot")}!`);
```

#### `user.sendCommand(command, args?)` — send a bot command

Produces the correct text and `bot_command` entity. Equivalent to a user typing `/command args` in Telegram.

```ts
await user.sendCommand("start");          // text: "/start"
await user.sendCommand("start", "ref42"); // text: "/start ref42"

// To a group:
await user.sendCommand(group, "help");
```

#### Media send methods

All media methods auto-generate `file_id`/`file_unique_id` and required fields. They all accept an optional leading `ChatObject` to send to a specific chat.

```ts
// Photo
await user.sendPhoto();
await user.sendPhoto({ caption: "Look!", spoiler: true });
await user.sendPhoto(group, { caption: format`${bold("Photo")} incoming` });

// Video
await user.sendVideo();
await user.sendVideo({ caption: "Watch this", spoiler: false });

// Document
await user.sendDocument();
await user.sendDocument({ caption: "file.pdf" });

// Voice message
await user.sendVoice();

// Audio file
await user.sendAudio();
await user.sendAudio({ caption: "My track" });

// Animation (GIF)
await user.sendAnimation();
await user.sendAnimation(group, { caption: "Funny gif" });

// Video note (circle video)
await user.sendVideoNote();

// Sticker (accepts Partial<TelegramSticker> overrides instead of MediaOptions)
await user.sendSticker();
await user.sendSticker({ emoji: "🔥", type: "custom_emoji" });

// Location
await user.sendLocation({ latitude: 48.8566, longitude: 2.3522 });

// Contact
await user.sendContact({ phone_number: "+1234567890", first_name: "Alice" });

// Dice
await user.sendDice();        // 🎲
await user.sendDice("🎯");
await user.sendDice(group, "🏀");
```

```ts
interface MediaOptions {
    caption?: string | FormattableString; // caption text (entities auto-extracted from FormattableString)
    spoiler?: boolean;                    // sets has_media_spoiler = true
}
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
await user.in(group).sendMessage(format`${bold("Hello")} group`);
await user.in(group).sendCommand("help");
await user.in(group).sendReply(originalMsg, "Thanks!");
await user.in(group).sendPhoto({ caption: "Look at this" });
await user.in(group).sendVideo();
await user.in(group).sendDocument();
await user.in(group).sendVoice();
await user.in(group).sendAudio();
await user.in(group).sendAnimation();
await user.in(group).sendVideoNote();
await user.in(group).sendSticker();
await user.in(group).sendLocation({ latitude: 51.5, longitude: -0.1 });
await user.in(group).sendContact({ phone_number: "+1" });
await user.in(group).sendDice("🎯");
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

#### `user.on(msg).clickByText(buttonText)` — click an inline button by its label

Scans the message's `inline_keyboard` for a button whose `text` matches, then emits a `callback_query` for its `callback_data`. Throws if no inline keyboard is present or no button matches. Accepts both plain JSON and Builder instances (e.g. `InlineKeyboard` from `@gramio/keyboards`) — Builders are unwrapped via `toJSON()` automatically.

```ts
msg.payload.reply_markup = {
    inline_keyboard: [
        [{ text: "Option A", callback_data: "opt:a" }],
        [{ text: "Option B", callback_data: "opt:b" }],
    ],
};

await user.on(msg).clickByText("Option B"); // emits callback_query with data "opt:b"
```

Most commonly paired with `env.lastBotMessage()` — the bubble's `reply_markup` stays in sync with the bot's edits automatically, so no manual refresh is needed between a button click and the next:

```ts
bot.on("message", (ctx) =>
    ctx.send("Pick:", {
        reply_markup: new InlineKeyboard().text("Next", "next"),
    }),
);
bot.on("callback_query:next", (ctx) =>
    ctx.editText("Done!", {
        reply_markup: new InlineKeyboard().text("Restart", "restart"),
    }),
);

await user.sendCommand("start");
const bubble = env.lastBotMessage()!;
await user.on(bubble).clickByText("Next");    // triggers the edit
await user.on(bubble).clickByText("Restart"); // same bubble, updated markup
```

#### `user.editMessage(message, text)` — edit a message

Updates the message's text in-memory and emits an `edited_message` update. Works with `bot.on("edited_message", ...)` handlers. GramIO exposes the edit timestamp as `ctx.updatedAt`.

```ts
const msg = await user.sendMessage("Original text");
await user.editMessage(msg, "Updated text");

// With FormattableString
await user.editMessage(msg, format`${bold("Bold")} new text`);
```

#### `user.forwardMessage(message, toChat?)` — forward a message

Emits a `message` update with `forward_origin` set. If `toChat` is omitted the message is forwarded to the user's private chat.

```ts
const original = await user.sendMessage(group, "Forward me!");
await user.forwardMessage(original);            // forward to own PM
await user.forwardMessage(original, otherGroup); // forward to another chat
```

#### `user.sendMediaGroup(chat, payloads[])` — send multiple media as an album

Emits one `message` update per item, all sharing the same `media_group_id`. Returns an array of `MessageObject`.

```ts
const [msg1, msg2] = await user.sendMediaGroup(group, [
    { photo: [{ file_id: "f1", file_unique_id: "u1", width: 800, height: 600 }] },
    { photo: [{ file_id: "f2", file_unique_id: "u2", width: 800, height: 600 }] },
]);

expect(msg1.payload.media_group_id).toBe(msg2.payload.media_group_id);
```

#### `user.pinMessage(message, inChat?)` — pin a message

Emits a service `message` update with `pinned_message` set. GramIO routes these to the `"pinned_message"` event (not `"message"`), so listen with `bot.on("pinned_message", ...)`.

```ts
const msg = await user.sendMessage("Important announcement");
await user.pinMessage(msg);        // pinned in msg's own chat
await user.pinMessage(msg, group); // pinned notification sent to a specific chat
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

#### `chat.post(text)` — anonymous channel post

Emits a `channel_post` update with no `from` field — matching real Telegram channel behavior. Use this to test `bot.on("channel_post", ...)` handlers.

```ts
const channel = env.createChat({ type: "channel", title: "My Channel" });

await channel.post("Breaking news!");
await channel.post(format`Check out ${bold("this")}`);
```

### `MessageObject`

Wraps `TelegramMessage` with a fluent builder API. Useful for constructing exotic messages that the `user.send*` shortcuts don't cover, then emitting them via `env.emitUpdate()`.

```ts
import { format, bold, link } from "gramio";
import { MessageObject } from "@gramio/test";

// Basic
const message = new MessageObject({ text: "Hello" })
    .from(user)
    .chat(group);

// Formatted text — entities extracted from FormattableString
new MessageObject()
    .from(user)
    .text(format`Check out ${link("https://gramio.dev", "GramIO")}`)
    .replyTo(originalMsg);

// Photo with spoiler
new MessageObject()
    .from(user)
    .photo()                     // auto-generates file_id and two sizes
    .caption(format`${bold("Spoiler!")}`)
    .spoiler();

// Rich message
new MessageObject()
    .from(user).chat(group)
    .text("media group item")
    .photo()
    .mediaGroupId("group-1")
    .topicMessage()
    .protect();
```

**Content methods:**

| Method | Description |
|--------|-------------|
| `.from(user)` | Set `from` field; auto-creates private chat if no chat set |
| `.chat(chat)` | Set `chat` field |
| `.text(str \| FormattableString)` | Set message text (entities auto-extracted from FormattableString) |
| `.caption(str \| FormattableString)` | Set caption (entities auto-extracted) |
| `.entities(...entities)` | Append text entities |
| `.captionEntities(...entities)` | Append caption entities |

**Attachment methods** (all auto-generate `file_id`/`file_unique_id`):

| Method | Description |
|--------|-------------|
| `.photo(overrides?)` | Attach photo (default: two sizes 100×100 and 800×600) |
| `.video(overrides?)` | Attach video (1280×720, 10s) |
| `.document(overrides?)` | Attach document |
| `.audio(overrides?)` | Attach audio (30s) |
| `.sticker(overrides?)` | Attach sticker (512×512, type "regular") |
| `.voice(overrides?)` | Attach voice (5s) |
| `.videoNote(overrides?)` | Attach video note (240px, 10s) |
| `.animation(overrides?)` | Attach animation (480×270, 3s) |
| `.contact(partial)` | Attach contact |
| `.location(partial)` | Attach location |
| `.dice(overrides?)` | Attach dice (🎲, random value) |
| `.venue(partial)` | Attach venue |
| `.game(partial)` | Attach game |
| `.story(partial)` | Attach story |
| `.poll(partial)` | Attach poll |
| `.successfulPayment(overrides?)` | Attach successful payment |

**Structure methods:**

| Method | Description |
|--------|-------------|
| `.replyTo(message)` | Set `reply_to_message` |
| `.spoiler()` | `has_media_spoiler = true` |
| `.protect()` | `has_protected_content = true` |
| `.topicMessage()` | `is_topic_message = true` |
| `.mediaGroupId(id)` | Set `media_group_id` |
| `.effectId(id)` | Set `effect_id` |
| `.viaBot(user)` | Set `via_bot` |
| `.quote(text, entities?)` | Set reply quote (accepts FormattableString) |
| `.linkPreviewOptions(options)` | Set `link_preview_options` |

#### Payments

Simulate Telegram Payments: pre-checkout queries, shipping queries, and successful payment service messages.

**`user.sendPreCheckoutQuery(overrides?)`** — emit a `pre_checkout_query` update:

```ts
const bot = new Bot("test");
bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery({ ok: true });
});

const env = new TelegramTestEnvironment(bot);
const user = env.createUser();

await user.sendPreCheckoutQuery({
    currency: "XTR",
    total_amount: 100,
    invoice_payload: "product_123",
});

const call = env.lastApiCall("answerPreCheckoutQuery");
expect(call).toBeDefined();
```

**`user.sendShippingQuery(overrides?)`** — emit a `shipping_query` update:

```ts
await user.sendShippingQuery({
    invoice_payload: "physical_item",
});
// Default shipping address is San Francisco, US
```

**`user.sendSuccessfulPayment(overrides?)`** — full payment flow: emits `pre_checkout_query` first, verifies the bot approved it, then emits `successful_payment`. This mirrors real Telegram behavior where a successful payment is only possible after the bot confirms the pre-checkout query.

```ts
bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery({ ok: true });
});
bot.on("successful_payment", (ctx) => {
    // ctx.successfulPayment.invoicePayload, ctx.successfulPayment.totalAmount, etc.
});

await user.sendSuccessfulPayment({
    currency: "XTR",
    total_amount: 100,
    invoice_payload: "sub_monthly",
});

// Send to a specific chat:
await user.sendSuccessfulPayment(group, { invoice_payload: "group_purchase" });

// Scoped variant:
await user.in(group).sendSuccessfulPayment({ invoice_payload: "scoped" });
```

Throws if the bot doesn't handle `pre_checkout_query` or rejects it with `ok: false` — just like Telegram would never send `successful_payment` in those cases.

### `PreCheckoutQueryObject`

Wraps `TelegramPreCheckoutQuery` with builder methods:

```ts
const query = new PreCheckoutQueryObject()
    .from(user)
    .currency("USD")
    .totalAmount(500)
    .invoicePayload("product_123")
    .shippingOptionId("express")
    .orderInfo({ name: "Alice" });
```

### `ShippingQueryObject`

Wraps `TelegramShippingQuery` with builder methods:

```ts
const query = new ShippingQueryObject()
    .from(user)
    .invoicePayload("physical_item")
    .shippingAddress({ country_code: "DE", city: "Berlin" });
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

Use `env.clearApiCalls()` to reset between logical phases of a test, and `env.lastApiCall(method)` to find the most recent call for a method without scanning the whole array:

```ts
await user.sendMessage("First");
await user.sendMessage("Second");

const last = env.lastApiCall("sendMessage");
expect(last?.params.text).toBe("Reply!"); // bot's response to "Second"

env.clearApiCalls();
expect(env.apiCalls).toHaveLength(0);
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
