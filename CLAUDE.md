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
- Uses the instance-local adapter in `src/api.ts` to intercept outgoing requests while preserving `preRequest`, formatting, response/error, `onApiCall`, and suppression semantics (no real HTTP or global fetch patch)
- Auto-assigns incrementing `update_id` to all updates passed through `emitUpdate()`
- Creates users (`createUser`) and chats (`createChat`), linking them to the environment
- `clearApiCalls()` empties observations only; messages and captured live references survive
- `lastApiCall(method)` returns the most recent recorded call for `method`, or `undefined`
- `filterApiCalls(method)` returns all calls for `method` with typed params/response
- `lastBotMessage(opts?)` / `botMessage(chatId, msgId)` return a `MessageObject` bubble tracking the bot's sent messages (see Bubble tracking below). Filters on `lastBotMessage`: `chat`, `withReplyMarkup`, `where: (call) => bool` (all AND)
- `message(chatId, msgId)` reads any active message. `updates` contains independent delivery snapshots. `dispose()` restores the original bot API. Multiple simultaneous environments on the same bot are rejected.
- `createDiscussion(channelPost, supergroup)` explicitly creates and emits the automatic forward serving as the discussion root, allowing first/nested comments without inventing threads for ordinary replies.

### Default API responses (`src/mock-api.ts`)

Preserve zero-configuration DX: implement a state-backed default whenever the environment has enough information; do not require test authors to mock ordinary bot interactions themselves. `onApi` is for overrides, failures, and unavailable external data, not routine setup. Built-ins include single/batch forward and copy (with album grouping), poll closure, live-location edits/stops, localized bot profile settings, chat menu buttons, and empty profile-photo reads. ID-only copy/batch responses still register full messages so bubble lookups work. Do not replace unimplemented non-boolean responses with a fabricated `true`.

`MockApi` provides state-backed defaults for text/media/album/poll/invoice sends, text/caption/markup/media edits, deletion, chat/member/file reads, command registration, pin/unpin, and common acknowledgements. API replies validate target existence (unless same-chat `allow_sending_without_reply`) and thread consistency; cross-chat replies use `external_reply` without inheriting the source thread. Commands are stored per scope/language. Methods not modeled yet require `env.onApi(method, handler)` instead of returning `true`. Static and async dynamic mocks are supported. The adapter's access to GramIO's private hook store is isolated, shape-checked, and covered by lifecycle tests; there is no public transport injection in GramIO 0.14. Do not spread this compatibility access through the codebase. Mock result casts are boundaries between method-indexed Telegram API types and the runtime method dispatcher.

### Params normalization (`src/utils.ts` → `normalizeParams`)

Before pushing to `env.apiCalls`, the proxy passes params through `normalizeParams`:
- `reply_markup` with a `.toJSON()` method (e.g. `InlineKeyboard` instance from `@gramio/keyboards`) is unwrapped to plain JSON.
- `results[].reply_markup` inside `answerInlineQuery` is unwrapped the same way.
- **Not** a deep recursive walk: other `toJSON`-bearing values (`Date`, `URL`, `Buffer`) are intentionally preserved. Only the known Builder locations are touched.

Net effect: `env.apiCalls[i].params.reply_markup.inline_keyboard` is always accessible as plain data — tests never need `JSON.parse(JSON.stringify(...))` roundtrips, and `clickByText` works regardless of whether the bot used a Builder or a plain object.

### Bubble tracking (`env.lastBotMessage` / `env.botMessage`)

The environment maintains one `messages` registry keyed by `${chatId}:${messageId}` for user and bot messages, plus a set of bot-originated messages. All high-level messages share the same per-chat ID allocator and `chat.messages` history. Sends register successful response snapshots (including media/albums/polls/invoices); edits update existing payloads in place only on success. Deletes remove messages from active history/lookups and mark live references `isDeleted`. A failed API call never changes message state.

`lastBotMessage` searches send observations in the current API journal, ignoring deleted messages. Its legacy `where` predicate is still specific to `sendMessage`. `botMessage` and captured references remain usable after `clearApiCalls`. API params/responses and delivered updates are snapshots; the typed `ApiCall.response` union includes `TelegramError`. Replies/pins use independent snapshots with nested `reply_to_message` removed.

### Object builders: `src/objects/`

Each builder wraps a Telegram type with auto-generated IDs and builder methods:

- **`UserObject`** — Primary actor. Holds a `TelegramUser` payload and an `asChat` (private chat). Action methods create the correct Telegram objects and emit updates via the environment. Requires `environment` to be set (done by `env.createUser()`).
  - Text: `sendMessage(text|FormattableString, opts?)`, `sendReply(msg, text)`, `sendCommand(command, args?)`
  - `sendReply` preserves the target message's `message_thread_id` when present, keeping nested replies in the same discussion; ordinary replies remain without a thread identifier.
  - Media: `sendPhoto`, `sendVideo`, `sendDocument`, `sendVoice`, `sendAudio`, `sendAnimation`, `sendVideoNote`, `sendSticker`, `sendLocation`, `sendContact`, `sendDice`
  - All send methods accept an optional leading `ChatObject` to target a specific chat instead of the private chat.
  - Advanced: `editMessage(msg, text)` (emits `edited_message`), `forwardMessage(msg, toChat?)` (emits forwarded `message` with `forward_origin`), `sendMediaGroup(chat, payloads[])` (emits multiple messages sharing a `media_group_id`), `pinMessage(msg, inChat?)` (emits service `message` with `pinned_message` — GramIO routes these to the `"pinned_message"` event)
  - Other: `join(chat)`, `leave(chat)`, `click(data, msg?)`, `react(emojis, msg?)`, `sendInlineQuery(...)`, `chooseInlineResult(...)`
  - `_emitMessage(chat, payload)` is the shared private helper used by all send methods.
- `user.send(builder)` imports arbitrary message content as this actor with fresh identity/state tracking. `env.emitUpdate` intentionally remains raw delivery and does not update world state. `sendMessage` infers a leading command entity without removing supplied formatting. `MessageOptions` and captioned `MediaOptions` accept `reply_to` and `message_thread_id`.
- User actions also include `editCaption`, `press` (text/contact reply keyboards), `vote` (non-anonymous polls with change/retract state), and `sendInlineResult` (materialize a successful answer to this user's query). Keep unsupported interactive button/result types explicit rather than silently fabricating input.
- **`ChatObject`** — Tracks members, active messages and `pinnedMessage`. `post(text)` requires a channel and emits `channel_post` without `from`; `editPost(message, text)` emits `edited_channel_post`. Membership transitions are idempotent. Actors/chats cannot cross environment boundaries or duplicate registered IDs.
- **`MessageObject`** — Wraps `TelegramMessage`. Builder methods: `.from(user)`, `.chat(chat)`. Content: `.text(str|FormattableString)`, `.caption(...)`, `.entities(...)`, `.captionEntities(...)`. Attachments (all auto-generate file_id): `.photo()`, `.video()`, `.document()`, `.audio()`, `.sticker()`, `.voice()`, `.videoNote()`, `.animation()`, `.contact()`, `.location()`, `.dice()`, `.venue()`, `.game()`, `.story()`, `.poll()`. Structure: `.replyTo(msg)`, `.spoiler()`, `.protect()`, `.topicMessage(threadId?)`, `.mediaGroupId()`, `.effectId()`, `.viaBot()`, `.quote()`, `.linkPreviewOptions()`. Internal `_chat?: ChatObject` is set by `.chat(chat)` and registration to enable `sendReply` chat lookup.
- **`CallbackQueryObject`** — Wraps `TelegramCallbackQuery`. Builder methods: `.from(user)`, `.message(msg)`, `.data(str)`.
- **`UserOnMessageScope`** — react/click/clickByText plus `reply`, `edit`, `editCaption`, `forward`, `pin`, `press`, and `vote`.
- **`UserInChatScope`** — chat-prebound send methods, inline actions, payments and membership. `.inTopic(id)` carries thread context through sends. Contradictory chat/topic scopes throw instead of silently changing destinations.

### Inline, guest, prepared messages and files

`sendInlineResult` materializes common cached/URL media, articles, location/venue/contact and supported input-message content (including invoices). Successful inline answers have a state registry independent of observations. Only `chosen_inline_result` is emitted; no incoming `message` is invented. A keyboard creates `MessageObject.inlineMessageId`; `env.inlineMessage(id)` resolves the live entity. Its callbacks carry an inline ID instead of `message`. Built-in inline edits return `true`, mutate the tracked payload and validate existence/upload restrictions. Game content is not fabricated from a short name. `chooseInlineResult` remains low-level delivery only.

`user.sendGuestMessage(input, chat?, options?)` emits `guest_message`; `env.guestMessage(queryId)` reads its source. Built-in `answerGuestQuery` creates an editable inline response and rejects unknown/answered IDs. `savePreparedInlineMessage` snapshots the result with a simulated five-minute expiration. `user.sendPreparedInlineMessage(id, chat?, options?)` materializes it after ownership, expiration and target-type checks, without inventing updates. Both helpers are available in chat/topic scopes.

`src/files.ts` owns environment-local identities/optional Blob bytes. Sends, cached reuse, user fixtures, albums and edits share metadata. Upload promises are resolved only at known upload fields before params are snapshotted; upstream API types currently require awaited uploads. `env.registerFile(input, metadata?)` seeds bytes/identity and `env.file(id)` reads metadata. Unknown `getFile` IDs reject; known ID-only fixtures cannot be downloaded until bytes are supplied. Public `bot.options.files.source` supplies local download bytes and is restored on dispose. No global fetch patch or URL download occurs; direct application fetches are outside this boundary.

### Handler errors and asynchronous outcomes

The instance-local hook adapter also installs/removes an error observer. `env.errors` journals `{ updateId, error }`; `emitUpdate` rethrows failures for its own update by default, after normal GramIO error handling. `new TelegramTestEnvironment(bot, { throwOnError: false })` explicitly permits error-observation tests. Do not restore silent false-positive tests by weakening ownership/API validation. `env.waitFor(predicate, { timeout?, interval? })` waits for an observable sync/async outcome with a bounded timeout (1000ms default, 5ms polling); it does not track arbitrary application timers or swallow predicate errors.

### ID generation details

Message/update IDs and album/payment action IDs are environment-local; all participants share each chat's sequence. Explicit fixture references reserve their message IDs. Generated group/channel IDs are negative and private IDs positive, avoiding collisions with generated users. Standalone builders, user/query/file IDs retain module-local fixture counters for backward compatibility. Fixture poll/payment IDs and action albums do not use wall-clock time, so freezing time cannot merge distinct entities. Builder dates use seconds, and replacement text/captions clear stale entities.

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
