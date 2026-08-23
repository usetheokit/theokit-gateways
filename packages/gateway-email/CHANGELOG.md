# Changelog

## 0.1.3

### Patch Changes

- e682180: **A message whose handler throws no longer kills the bot.** On Teams and on WhatsApp's web backend it did — not degraded delivery, an exit code. `Error: ... / Node.js v22.22.2`, and the next message never arrived.

  Both dispatched with `void handler(event)`. `void` reads as "I am not waiting for this"; what it tells the runtime is "I am not handling the error", and under Node 22's default an unhandled rejection ends the process. Measured against both adapters through their own injection seams before the fix, and again after: the throw is now contained, named, and delivery continues.

  **Discord and Telegram contained it but blamed the wrong thing.** The rejection escaped into the platform library's error channel, so a bug in the consumer's own handler surfaced as `[discord] client error` / `[telegram] bot error`. Anyone debugging that went looking in discord.js and grammy for a fault that was in their own code. Both now report `handler threw` and return `"handler_threw"` from the internal dispatch seam.

  **WhatsApp Cloud dropped the rest of the batch, and made the platform resend it.** Meta packs several messages and their delivery receipts into one webhook, and the dispatch loop awaited each handler with nothing around it. One throw skipped every remaining message in the payload, skipped the status receipts, and rejected `handleWebhookPayload` — so the caller's route answered 500 and Meta redelivered the whole batch, replaying the messages that had already been handled. That is a duplicate-reply bug reached through a different door than the one fixed in #11. The same method also now answers `false` on a signed body that is not JSON, instead of throwing out of a method whose contract is `true`/`false`.

  **Email gained a net it did not strictly need.** Its drain is written never to reject, and it does not — but both launch sites discard the promise, so that property was the only thing between a future edit and the same fatal rejection, and nothing enforced it. The catch now lives at the site that would pay for it.

  **The contract is written down, and held to.** `BasePlatformAdapter.onInbound` now states it: a handler may throw, and an adapter must contain that throw, report it as the handler's failure rather than the platform's, and keep delivering. Eight of ten adapters had converged on exactly that with nothing recording it. `tests/lint/adapter-contract.test.ts` gains two invariants — every adapter names a handler throw as the handler's, and no adapter launches a user callback with a bare `void` — and both were checked against a deliberately reverted adapter to confirm they fire rather than pass vacuously.

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

- 4e6ae26: **The published type declarations now compile.** Five of these packages shipped a `.d.ts` (and matching `.d.cts`) containing type references that resolve to nothing — nine names, replicated across both module formats. `skipLibCheck: true` is on by default in most consumer projects, so the packages installed, imported and looked correct; under type-aware lint, which resolves the real type graph and has no such escape, every type reached through a broken reference degrades to `error`, and ordinary correct calls into these adapters come back flagged `no-unsafe-*`.

  The names, all now bound: `EmailMessageEvent` (email), `SendResult` and `SlackMessageEvent` (slack), `GatewayConfigurationError` and `GatewayConfigurationErrorOptions` (sms), `TeamsMessageEvent` (teams), `ChildProcess` and `WhatsAppSendResult` (whatsapp).

  Nothing was wrong with the source — every package's own `tsc --noEmit` was green throughout, which is exactly why this survived. The defect is in how tsup's declaration rollup emits the bundle: it re-exports a name without binding it locally, drops a type-only import from an external module while inlining the declarations that use it, or renames a declaration to avoid a collision and misses one use site. The `sms` names are the newest instance — the shared `GatewayConfigurationError` base introduced in `@theokit/gateway` 0.5.0 turned a local type into an external one, which is the shape the rollup drops.

  The public surface of every package is unchanged: the same names are exported, and the repair that rewrites a re-export verifies that before and after. What changed is where a name is bound inside the declaration file.

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

## [0.1.0] - 2026-05-24

### Added

- Initial release. Email platform adapter for `@theokit/gateway` (Roadmap v1.4 #4).
- `EmailAdapter` extending `BasePlatformAdapter` (ADRs D327-D339).
- Community-standard stack: `nodemailer@^8` (SMTP) + `imapflow@^1` (IMAP IDLE) + `mailparser@^3` (RFC 5322).
- IMAP IDLE preferred, 15s polling fallback (D328).
- Threading via `Message-ID` / `In-Reply-To` / `References` chain — RFC 5322 §3.6.4 (D329).
- `splitForEmail`-style 50000-char body truncation (EC-2).
- Automated-sender filter ON by default (regex + RFC 3834 `Auto-Submitted` header) — D332.
- Allowed-sender allowlist with bracketed-entry normalization (D333 + EC-3).
- `mapEmailError` HTTP / plain-Error mapper.
- DM-only channel mapping (D336); group threads deferred to v0.2.
- Outbound threading reciprocity with References dedup (D337 + EC-6).
- Own-address loopback drop guard (EC-1 CRITICAL).
- Concurrent dispatch serialized via Promise queue (EC-4).
- Subject fallback `"(no subject)"` when missing (EC-5).
- Seen-UID Set with FIFO cap at 5000 (D331).
