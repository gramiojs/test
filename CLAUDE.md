# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@gramio/test` — an event-driven test framework for [GramIO](https://gramio.dev) Telegram bots. Users are the primary actors: they send messages, join/leave chats, click inline buttons. The framework manages in-memory state and emits the correct Telegram updates to the bot under test.

## Commands

- **Run tests:** `bun test`
- **Run a single test file:** `bun test tests/index.test.ts`
- **Type check:** `bunx tsc --noEmit` (TypeScript is a devDependency, not globally installed)
- **Build for publishing:** `bunx pkgroll`

## Architecture

### Entry point: `src/index.ts`

`TelegramTestEnvironment` is the central orchestrator. It:
- Wraps a GramIO `Bot` instance
- Replaces `bot.api` with a `Proxy` that intercepts all outgoing API calls (no real HTTP), records them in `env.apiCalls`, and returns mock responses
- Auto-assigns incrementing `update_id` to all updates passed through `emitUpdate()`
- Creates users (`createUser`) and chats (`createChat`), linking them to the environment
- `clearApiCalls()` empties the `apiCalls` array
- `lastApiCall(method)` returns the most recent recorded call for `method`, or `undefined`

### Object builders: `src/objects/`

Each builder wraps a Telegram type with auto-generated IDs and builder methods:

- **`UserObject`** — Primary actor. Holds a `TelegramUser` payload and an `asChat` (private chat). Action methods create the correct Telegram objects and emit updates via the environment. Requires `environment` to be set (done by `env.createUser()`).
  - Text: `sendMessage(text|FormattableString, opts?)`, `sendReply(msg, text)`, `sendCommand(command, args?)`
  - Media: `sendPhoto`, `sendVideo`, `sendDocument`, `sendVoice`, `sendAudio`, `sendAnimation`, `sendVideoNote`, `sendSticker`, `sendLocation`, `sendContact`, `sendDice`
  - All send methods accept an optional leading `ChatObject` to target a specific chat instead of the private chat.
  - Advanced: `editMessage(msg, text)` (emits `edited_message`), `forwardMessage(msg, toChat?)` (emits forwarded `message` with `forward_origin`), `sendMediaGroup(chat, payloads[])` (emits multiple messages sharing a `media_group_id`), `pinMessage(msg, inChat?)` (emits service `message` with `pinned_message` — GramIO routes these to the `"pinned_message"` event)
  - Other: `join(chat)`, `leave(chat)`, `click(data, msg?)`, `react(emojis, msg?)`, `sendInlineQuery(...)`, `chooseInlineResult(...)`
  - `_emitMessage(chat, payload)` is the shared private helper used by all send methods.
- **`ChatObject`** — Wraps `TelegramChat`. Tracks `members: Set<UserObject>` and `messages: MessageObject[]` as in-memory state. Has `environment?: TelegramTestEnvironment` (set by `env.createChat()`). `post(text)` emits a `channel_post` update (no `from` field — for channel bots).
- **`MessageObject`** — Wraps `TelegramMessage`. Builder methods: `.from(user)`, `.chat(chat)`. Content: `.text(str|FormattableString)`, `.caption(...)`, `.entities(...)`, `.captionEntities(...)`. Attachments (all auto-generate file_id): `.photo()`, `.video()`, `.document()`, `.audio()`, `.sticker()`, `.voice()`, `.videoNote()`, `.animation()`, `.contact()`, `.location()`, `.dice()`, `.venue()`, `.game()`, `.story()`, `.poll()`. Structure: `.replyTo(msg)`, `.spoiler()`, `.protect()`, `.topicMessage()`, `.mediaGroupId()`, `.effectId()`, `.viaBot()`, `.quote()`, `.linkPreviewOptions()`. Internal `_chat?: ChatObject` is set by `_emitMessage` to enable `sendReply` chat lookup.
- **`CallbackQueryObject`** — Wraps `TelegramCallbackQuery`. Builder methods: `.from(user)`, `.message(msg)`, `.data(str)`.
- **`UserOnMessageScope`** (from `user.on(msg)`) — `.react(emojis)`, `.click(data)`, `.clickByText(buttonText)` (scans `inline_keyboard` for a button with matching text and clicks its `callback_data`).
- **`UserInChatScope`** (from `user.in(chat)`) — all `sendMessage/sendCommand/sendReply/sendPhoto/sendVideo/sendDocument/sendVoice/sendAudio/sendAnimation/sendVideoNote/sendSticker/sendLocation/sendContact/sendDice/sendInlineQuery/join/leave/on(msg)` variants with the chat pre-bound.

### ID generation

Module-level `let` counters (`lastUserId`, `lastChatId`, `lastCallbackQueryId`, `lastFileId`) auto-increment. `lastMessageIdPerChat` is a `Map<chatId, messageId>` for per-chat message ID sequences. `genFile()` (exported from `src/utils.ts`) uses `lastFileId` to produce `{ file_id, file_unique_id }` pairs for media attachments. All counters are module-scoped globals — they persist across tests within the same process.

### Circular import handling

`UserObject` needs `TelegramTestEnvironment` but `index.ts` imports `UserObject`. This is resolved with `import type` in `user.ts` (erased at runtime due to `verbatimModuleSyntax`).

## Documentation

When adding or changing public API (new methods, classes, options), update **both** `README.md` and `CLAUDE.md` to reflect the change. The README is the primary user-facing documentation; CLAUDE.md keeps this architecture section accurate for AI assistants.

## Key Patterns

- Telegram types come from `@gramio/types` (low-level) and `gramio` (re-exports + framework types like `AnyBot`)
- All `.ts` imports use explicit `.ts` extensions (`moduleResolution: "NodeNext"`)
- Tests use `bun:test` (`describe`, `it`, `expect`)
- Create a fresh `Bot` + `TelegramTestEnvironment` per test to avoid handler accumulation
- User action methods pass raw `TelegramUpdate` objects to `emitUpdate()` with `update_id: 0` (overwritten by the environment)
