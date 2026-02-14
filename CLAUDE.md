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

### Object builders: `src/objects/`

Each builder wraps a Telegram type with auto-generated IDs and builder methods:

- **`UserObject`** — Primary actor. Holds a `TelegramUser` payload and an `asChat` (private chat). Action methods (`sendMessage`, `join`, `leave`, `click`) create the correct Telegram objects and emit updates via the environment. Requires `environment` to be set (done by `env.createUser()`).
- **`ChatObject`** — Wraps `TelegramChat`. Tracks `members: Set<UserObject>` and `messages: MessageObject[]` as in-memory state.
- **`MessageObject`** — Wraps `TelegramMessage`. Builder methods: `.from(user)` (auto-creates private chat if none set), `.chat(chat)`.
- **`CallbackQueryObject`** — Wraps `TelegramCallbackQuery`. Builder methods: `.from(user)`, `.message(msg)`, `.data(str)`.

### ID generation

Module-level `let` counters (`lastUserId`, `lastChatId`, `lastCallbackQueryId`) auto-increment. `lastMessageIdPerChat` is a `Map<chatId, messageId>` for per-chat message ID sequences. These are module-scoped globals — they persist across tests within the same process.

### Circular import handling

`UserObject` needs `TelegramTestEnvironment` but `index.ts` imports `UserObject`. This is resolved with `import type` in `user.ts` (erased at runtime due to `verbatimModuleSyntax`).

## Documentation

When adding or changing public API (new methods, classes, options), update `README.md` with corresponding usage examples. The README serves as the primary user-facing documentation for the package.

## Key Patterns

- Telegram types come from `@gramio/types` (low-level) and `gramio` (re-exports + framework types like `AnyBot`)
- All `.ts` imports use explicit `.ts` extensions (`moduleResolution: "NodeNext"`)
- Tests use `bun:test` (`describe`, `it`, `expect`)
- Create a fresh `Bot` + `TelegramTestEnvironment` per test to avoid handler accumulation
- User action methods pass raw `TelegramUpdate` objects to `emitUpdate()` with `update_id: 0` (overwritten by the environment)
