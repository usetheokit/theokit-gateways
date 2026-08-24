# Changelog

## 0.1.5

### Patch Changes

- Every credential field now says what the platform calls it and where it is issued.

  Measured: a developer who wires one adapter and carries its field name to the next gets
  `error TS2353: … 'token' does not exist in type 'SlackAdapterOptions'`. That names the wrong field
  and the type, and never the right one — so the answer was always one file away.

  These docblocks are on published option types, so an editor now shows the answer on hover and
  completion. All 15 credential-bearing fields across the ten packages are covered, including the ones
  beyond each adapter's primary token: Slack's `appToken`, LINE's `channelSecret`, Vonage's
  `apiSecret` and `signatureSecret`, WhatsApp's `appSecret`.

  **Nothing was renamed.** Six of the ten primary names are the platform's own key, pinned against the
  SDK's own declaration — `channelAccessToken` in `@line/bot-sdk`, `clientSecret` in
  `@microsoft/teams.apps`, `accessToken` in `matrix-js-sdk`, `token` in `grammy` and `discord.js`,
  `authToken` in `twilio`. Where ours diverges, the docblock says so rather than implying otherwise:
  `botToken` (deliberate — the adapter also takes an `appToken`), Mattermost's `accessToken` against
  its client's `token`, and `password` against nodemailer's `pass`.

## 0.1.4

### Patch Changes

- Drop the unused `@theokit/sdk` peer dependency, so a TheoKit app can install an adapter.

  Every adapter declared `peer @theokit/sdk@^2.18.0` and imported the SDK in **zero** source files.
  The framework ships `@theokit/sdk@4.x`, so `npm install @theokit/gateway-line` into a TheoKit app
  failed outright with `ERESOLVE`.

  The core's range was widened in `@theokit/gateway@0.7.0`, which was not enough on its own: an
  adapter's own manifest still carried the pin, so installing one still failed even against the fixed
  core. Measured in a real app before and after.

## 0.1.3

### Patch Changes

- 8cbf136: **Every published export now carries documentation.** Forty-seven public symbols shipped with no docblock at all, so a consumer hovering `DiscordAdapter`, `SlackAdapter`, `WhatsAppCloudBackend`, `ThreadStore` or any of the error classes got an empty tooltip. Coverage across the eleven packages went from 71.2% to 100% (163/163), measured over the published declarations rather than the source, because a docblock is not documentation until it survives the build.

  The text says what each symbol is for and what constrains it, not what its name already says. `TelegramAdapter` records that a bot cannot enumerate its chats nor speak into one that has not spoken first. `DiscordAdapter` records that reading message content needs a privileged intent enabled in the developer portal, without which every `event.text` arrives empty and nothing says why. `WhatsAppWebBackend` records that it is unofficial and can get a number banned. `shouldDispatchSyncEvent` records that Matrix replays history on sync, which is why a freshly started bot would otherwise answer every message it can still see.

  **`gateway-slack`'s README documented a type that does not exist.** Its usage example imported `GatewayMessageEvent` from `@theokit/gateway`. That name is an internal alias inside the Discord and Telegram adapters (`MessageEvent as GatewayMessageEvent`), never an export. A reader who copied the example got code that did not compile. It now imports `MessageEvent`, which is what `onInbound` actually hands the handler.

  Two docblocks that attached to nothing were reattached: `acquirePidLock` in `gateway-whatsapp` had its documentation stranded thirty lines above, over a different function, and shipped undocumented as a result.

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
