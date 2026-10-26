# Changelog

## 0.9.0

### Conversation simulation without routine API mocks

- Share message IDs and chat history across users and the bot. Follow replies, topic discussions, edits, deletions and channel comments through live message references.
- Use state-backed defaults for text/media/albums, polls, invoices, forwarding/copying, chat/member/file reads, profile settings, commands, pins and acknowledgements. Custom `onApi` handlers still override defaults; `offApi` restores them.
- Replay inline audio/photo placeholders, chosen results, media replacements and button clicks through `inline_message_id`, without inventing incoming message updates.
- Simulate guest responses and Mini App prepared-message sharing, including ownership, target-chat and expiration checks.
- Preserve uploaded file metadata and stable identities. Download registered bytes through the real GramIO download helpers without network access.
- Keep formatting and request/response/error hooks, API wrappers and error suppression through instance-local interception. Restore API and download configuration with `dispose()`.
- Add fluent topic/message actions, reply-keyboard presses, poll voting, a handler-error journal and bounded `waitFor` polling for asynchronous outcomes.

### Migration notes

- Handler failures now reject awaited user actions by default, even when the bot handles them with `onError`. For error-handler tests, opt into `{ throwOnError: false }` and assert `env.errors`.
- `clearApiCalls()` clears observations, not conversation state. Captured message references and `botMessage()` remain usable; `lastBotMessage()` searches the current journal.
- `sendInlineResult()` emits only `chosen_inline_result`. Inline callbacks contain `inline_message_id`, not `message`. Results without keyboards do not receive an inline ID.
- API call responses may be `TelegramError`; narrow before reading successful-result fields. Missing targets, duplicate IDs and unsupported methods now fail explicitly instead of fabricating successful results.
- Supply file bytes only when a test actually downloads a file. ID-only fixtures remain sufficient for ordinary message handling. Application-level HTTP calls, databases and music services remain outside the simulator.
- Existing peer requirements remain GramIO >=0.14, @gramio/contexts >=0.11 and @gramio/types >=10.3.1, within their declared upper bounds.

### Verification

- 242 passing tests and 730 assertions; 95.39% line coverage.
- TypeScript, Biome, package build and ESM/CommonJS smoke checks passed.
- Targeted local scenarios passed against actual views, auto-answer-callback-query, auto-retry and nowtrackbot media-retry plugin sources; the full production bot was not started.
