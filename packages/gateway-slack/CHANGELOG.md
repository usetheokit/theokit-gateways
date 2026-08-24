# Changelog

## 0.2.2

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

## 0.2.1

### Patch Changes

- Drop the unused `@theokit/sdk` peer dependency, so a TheoKit app can install an adapter.

  Every adapter declared `peer @theokit/sdk@^2.18.0` and imported the SDK in **zero** source files.
  The framework ships `@theokit/sdk@4.x`, so `npm install @theokit/gateway-line` into a TheoKit app
  failed outright with `ERESOLVE`.

  The core's range was widened in `@theokit/gateway@0.7.0`, which was not enough on its own: an
  adapter's own manifest still carried the pin, so installing one still failed even against the fixed
  core. Measured in a real app before and after.

## 0.2.0

### Minor Changes

- d46fd6c: **Slack — a routine reconnect from Slack could kill your process, and shutting down mid-connect leaked a socket.**

  Slack periodically asks a Socket Mode client to refresh its connection. When that message arrived while the socket was still opening, the state machine inside `@slack/socket-mode` 1.x had no transition for it and threw `Unhandled event 'server explicit disconnect' in state 'connecting'`. It threw from an asynchronous websocket handler, so nothing in this adapter — or in your application — could catch it: it surfaced as an unhandled rejection, which Node treats as fatal. Observed on 2 of 3 consecutive live runs, where it turned a fully green test suite into a red job (#31).

  The defect was never in this adapter, and there is no way to guard it from the outside. It was fixed upstream by deleting the state machine: `@slack/socket-mode` 2.x dropped the `finity` dependency entirely, and handles Slack's refresh message by simply closing the websocket. So the peer requirement moves to **`@slack/bolt` `^4.0.0 || ^5.0.0`**, the versions that carry a fixed socket-mode. Both were verified here against the adapter's full suite.

  This is a breaking change for anyone on Bolt 3: upgrade `@slack/bolt` alongside this package. Nothing in this adapter's own API changed — the same options, the same methods, the same events. Note that Bolt 5 pulls `@slack/socket-mode` 3.x, which needs `undici` `^7`; Bolt 4 has no such requirement.

  **`disconnect()` during an in-flight `connect()` stopped nothing.** The guard tested a `connected` flag that only flips after both `app.start()` and `auth.test()` resolve, so a shutdown arriving in that window returned immediately while the socket was still opening — and once `connect()` finished, no reference remained that could close it. It now waits for the in-flight connect and tears down the App itself, so a half-connected client is closed rather than left running. `disconnect()` before any `connect()`, and repeated calls, stay no-ops as before.

### Patch Changes

- 8cbf136: **Every published export now carries documentation.** Forty-seven public symbols shipped with no docblock at all, so a consumer hovering `DiscordAdapter`, `SlackAdapter`, `WhatsAppCloudBackend`, `ThreadStore` or any of the error classes got an empty tooltip. Coverage across the eleven packages went from 71.2% to 100% (163/163), measured over the published declarations rather than the source, because a docblock is not documentation until it survives the build.

  The text says what each symbol is for and what constrains it, not what its name already says. `TelegramAdapter` records that a bot cannot enumerate its chats nor speak into one that has not spoken first. `DiscordAdapter` records that reading message content needs a privileged intent enabled in the developer portal, without which every `event.text` arrives empty and nothing says why. `WhatsAppWebBackend` records that it is unofficial and can get a number banned. `shouldDispatchSyncEvent` records that Matrix replays history on sync, which is why a freshly started bot would otherwise answer every message it can still see.

  **`gateway-slack`'s README documented a type that does not exist.** Its usage example imported `GatewayMessageEvent` from `@theokit/gateway`. That name is an internal alias inside the Discord and Telegram adapters (`MessageEvent as GatewayMessageEvent`), never an export. A reader who copied the example got code that did not compile. It now imports `MessageEvent`, which is what `onInbound` actually hands the handler.

  Two docblocks that attached to nothing were reattached: `acquirePidLock` in `gateway-whatsapp` had its documentation stranded thirty lines above, over a different function, and shipped undocumented as a result.

- 9c35372: **Slack now answers `empty_text` for empty text, like the other nine adapters.** The contract states it without a condition — `sendMessage` with empty text returns `{ ok: false, code: "empty_text" }` — but Slack checked the connection first, so the same call answered `not_connected` there and `empty_text` everywhere else.

  Nobody lost a delivery over it: both results are already `ok: false`. What broke is code that branches on the code — treating a caller's bad input one way and an unavailable transport another, with a retry or an alert behind the second. Written against the contract, that code did the right thing on nine platforms and the wrong thing on the tenth, with nothing to say why.

  The connection guard keeps its reason (`this.app` is set before `app.start()` resolves, so a send in that window would otherwise leak through); only the order changed. Input first, transport second, which is what `rules/error-handling.md` § 2 asks for and what the other nine already did.

  The cross-adapter gate gains the invariant, and it is checked against a deliberately reverted adapter. That check earned its keep immediately: the first version of the invariant read a window of raw source that its own explanatory comment filled, so it passed against the reverted adapter by matching the prose describing the rule. It now strips comments before asking — a gate answered by a comment is worse than no gate, because it reports coverage it does not have.

- b8ef098: **Every package now ships the licence it declares.** All twelve manifests in this repository declare `Apache-2.0`, and the repository had no `LICENSE` file at all — not at the root, and not in any package directory except `gateway-email`. So each published tarball asserted a licence while carrying none of its terms, and §4(a) of that licence requires a copy to travel with the distribution. Worse than a missing file: with no licence text anywhere, everything outside the manifests fell back to default copyright, which grants a recipient nothing.

  The text is now at the repository root and inside every publishable package, byte-identical to the canonical Apache License 2.0 with the appendix filled in (`Copyright 2026 usetheo.dev`). The one pre-existing copy, in `gateway-email`, was replaced along with the rest: it carried the same truncated paragraph 4(d) found across the ecosystem, dropping "reasonable and customary use" from the NOTICE clause — a modified body under an unmodified SPDX identifier.

  **The repository moved to the official `usetheokit` organization.** Existing clones and published URLs keep working through GitHub's permanent redirect; the root manifest now declares `Apache-2.0` explicitly rather than leaving the workspace root silent.

- 4e6ae26: **The published type declarations now compile.** Five of these packages shipped a `.d.ts` (and matching `.d.cts`) containing type references that resolve to nothing — nine names, replicated across both module formats. `skipLibCheck: true` is on by default in most consumer projects, so the packages installed, imported and looked correct; under type-aware lint, which resolves the real type graph and has no such escape, every type reached through a broken reference degrades to `error`, and ordinary correct calls into these adapters come back flagged `no-unsafe-*`.

  The names, all now bound: `EmailMessageEvent` (email), `SendResult` and `SlackMessageEvent` (slack), `GatewayConfigurationError` and `GatewayConfigurationErrorOptions` (sms), `TeamsMessageEvent` (teams), `ChildProcess` and `WhatsAppSendResult` (whatsapp).

  Nothing was wrong with the source — every package's own `tsc --noEmit` was green throughout, which is exactly why this survived. The defect is in how tsup's declaration rollup emits the bundle: it re-exports a name without binding it locally, drops a type-only import from an external module while inlining the declarations that use it, or renames a declaration to avoid a collision and misses one use site. The `sms` names are the newest instance — the shared `GatewayConfigurationError` base introduced in `@theokit/gateway` 0.5.0 turned a local type into an external one, which is the shape the rollup drops.

  The public surface of every package is unchanged: the same names are exported, and the repair that rewrites a re-export verifies that before and after. What changed is where a name is bound inside the declaration file.

## 0.1.2

### Patch Changes

- b8ef098: **Every package now ships the licence it declares.** All twelve manifests in this repository declare `Apache-2.0`, and the repository had no `LICENSE` file at all — not at the root, and not in any package directory except `gateway-email`. So each published tarball asserted a licence while carrying none of its terms, and §4(a) of that licence requires a copy to travel with the distribution. Worse than a missing file: with no licence text anywhere, everything outside the manifests fell back to default copyright, which grants a recipient nothing.

  The text is now at the repository root and inside every publishable package, byte-identical to the canonical Apache License 2.0 with the appendix filled in (`Copyright 2026 usetheo.dev`). The one pre-existing copy, in `gateway-email`, was replaced along with the rest: it carried the same truncated paragraph 4(d) found across the ecosystem, dropping "reasonable and customary use" from the NOTICE clause — a modified body under an unmodified SPDX identifier.

  **The repository moved to the official `usetheokit` organization.** Existing clones and published URLs keep working through GitHub's permanent redirect; the root manifest now declares `Apache-2.0` explicitly rather than leaving the workspace root silent.

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

### Added

- `SlackAdapter` implementing `BasePlatformAdapter` (Roadmap #7; ADRs D267-D285).
- Socket Mode transport via `@slack/bolt` (D267, D268).
- `SlackMessageEvent` variant added to gateway `MessageEvent` union (D274).
- `splitForSlack` 4000-char + surrogate-pair guard (D272).
- `mapSlackError` SlackApiError → canonical SendResult codes (D273).
- `requireMention: true` default for channels to prevent cost explosion (D285).
- Bot loop guard via cached `botUserId` (D275, D277).
