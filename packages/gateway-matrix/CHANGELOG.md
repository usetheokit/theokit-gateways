# Changelog

## 0.1.2

### Patch Changes

- b8ef098: **Every package now ships the licence it declares.** All twelve manifests in this repository declare `Apache-2.0`, and the repository had no `LICENSE` file at all — not at the root, and not in any package directory except `gateway-email`. So each published tarball asserted a licence while carrying none of its terms, and §4(a) of that licence requires a copy to travel with the distribution. Worse than a missing file: with no licence text anywhere, everything outside the manifests fell back to default copyright, which grants a recipient nothing.

  The text is now at the repository root and inside every publishable package, byte-identical to the canonical Apache License 2.0 with the appendix filled in (`Copyright 2026 usetheo.dev`). The one pre-existing copy, in `gateway-email`, was replaced along with the rest: it carried the same truncated paragraph 4(d) found across the ecosystem, dropping "reasonable and customary use" from the NOTICE clause — a modified body under an unmodified SPDX identifier.

  **The repository moved to the official `usetheokit` organization.** Existing clones and published URLs keep working through GitHub's permanent redirect; the root manifest now declares `Apache-2.0` explicitly rather than leaving the workspace root silent.

- 5bae032: Six defects that broke real conversations, found by testing the adapters against the live platforms instead of against fakes.

  **LINE — no outbound message was ever delivered.** The adapter called the v9 SDK client with positional arguments while that client takes a single request object, so LINE received an empty request and rejected every send with a 400. Upgrade if you use this adapter at all: nothing it sent reached anyone.

  **Telegram — the bot froze on long replies.** Any message over 4096 characters that began with an unclosed code span (a stray backtick) put the splitter into an infinite loop, hanging the process until it ran out of memory. Long agent answers now split correctly whatever markdown they contain.

  **Mattermost — long messages silently vanished.** The adapter never split anything, so any reply over 16,383 characters was rejected by the server and the user simply saw nothing. Long replies are now split into parts Mattermost accepts.

  **SMS — long messages were rejected from the hundredth part onward.** The `(i/N)` prefix outgrew the space reserved for it, pushing every later part past the provider's limit.

  **Matrix and LINE — `connect()` reported success with an invalid token.** Both now verify the credential with the server before returning `true`, so a wrong token fails at startup instead of silently receiving nothing forever.

  **Email and Teams — the bot could go permanently deaf.** Replacing an inbound handler and then disposing of the previous one removed the new handler as well, and the gateway stopped receiving messages with nothing logged.

  Also: a `pre_inbound` hook that threw put its raw error text into the user's chat, which could expose internal details such as connection strings or tokens. Users now see only which hook failed; the detail goes to the server log, redacted.

  WhatsApp additionally stops opening a second session when `connect()` is called twice, and its group mention filter no longer treats unrelated digits scattered through a message as a mention of the bot.

- 7ccb21b: Two defects that only a real server could show, both found by the live suites.

  **Email — the bot re-answered its whole unread inbox after every restart.** Nothing ever flagged a message as read on the server, and the only record of what had already been handled lived in memory and was thrown away on disconnect. So each reconnect fetched the entire unread backlog again and delivered all of it a second time: on the test mailbox, 166 messages meant 166 duplicate replies to the people who had written in. It got worse over time, because the backlog only ever grew. Messages are now flagged on the server once handled, in a single command per batch, so a restart picks up where it left off.

  **Matrix — `disconnect()` could kill your process.** Shutting the client down cancels the requests it has open, and one of those cancellations surfaced as an unhandled rejection, which Node treats as fatal. An application that reconnects — the well-behaved kind, with retry on connection loss — could be terminated by its own clean shutdown. Measured against a real homeserver before the fix: 7 occurrences in 8 connect/disconnect cycles. Cancellations during shutdown are now contained, while any cancellation you request yourself through `getClient()` still reaches you unchanged.

## 0.1.1

### Patch Changes

- e926cd9: Align the gateway cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from `^1.9.0` to `^2.18.0` across all 11 packages. The only consumed SDK surface is `Security.redact` (in the gateway core runner) — a stable public API (ADR D68) unchanged across 1.x→2.x — so the alignment is a pin bump, not a migration. Validated: all 11 packages typecheck + build + test green against 2.18.0 (543 tests passed). No dead/unwired surfaces (`no-stubs-no-mocks-no-wired` checklist clean).

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0
  - @theokit/gateway@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0
  - @theokit/gateway@1.0.0

## [Unreleased]

### Added — `@theokit/gateway-matrix@0.1.0` (ADRs D413-D421)

- Initial release of the Matrix protocol adapter for `@theokit/gateway`.
- `matrix-js-sdk@^32.0.0` peer-dep (lazy import — full SDK is ~2MB).
- `MatrixAdapter` extending `BasePlatformAdapter`:
  - `connect()` initializes `MatrixClient` with `homeserverUrl + accessToken + userId`; starts sync loop with `initialSyncLimit: 10` (D414, D415).
  - `disconnect()` stops client gracefully; idempotent.
  - `sendMessage()` posts via `client.sendTextMessage(roomId, text)`; reply to alias resolves to room id via `getRoomIdForAlias` (D419).
  - `onInbound()` replace semantics (EC-H).
- Sync loop wrapper (`sync.ts`) filters out:
  - Non-`m.room.message` events (D413).
  - Bot's own messages (loop guard).
  - **EC-3 absorbed**: events older than 60s (initial sync flood prevention — a bot in 50 rooms × 10 events = 500 LLM calls on boot).
- Room state (`room-state.ts`):
  - DM detection (D416): `room.getJoinedMemberCount() === 2` → `channel.type: "dm"`; else `"group"`.
- Alias resolution (D419): caller passes `#general:matrix.org` OR `!abc123:matrix.org`; adapter resolves alias → room id on first use, caches.
- E2EE rooms refused with warn stderr (D418) — v0.1 only operates on unencrypted rooms.
- Federation transparent (D420) — Matrix SDK handles cross-homeserver routing.
- Matrix events preserved in `event.matrix.raw` (D421) for caller access to redactions, relations, etc.
- Threads (MSC4140) deferred to v0.2 (D417).
- E2EE (Olm/Megolm) deferred to v0.2 (D418).
