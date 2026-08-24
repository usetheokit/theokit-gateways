# Changelog

## 0.2.2

### Patch Changes

- 29e2e28: The seam between the three repositories is documented, and the reason given for one contract was corrected.

  `@theokit/gateway`'s README — the npm page — now says which repository owns which half: TheoKit the
  HTTP route and the signature check, these packages the translation of the payload it hands over, the
  SDK one redaction helper. A `quality:integration-story` gate fails when that disappears and passes
  when the prose is rewritten around the same facts.

  Both adapters' published docblocks stated that a TheoKit app's `onMessage` runs AFTER the 200 is
  answered, so a throw there had no status left to change. Measured against `theokit@0.48.14`,
  `handleChannelWebhook` awaits `onMessage` BEFORE building the response and catches nothing around
  it: a throw means the 200 is never built, and mounted in a TheoKit route the rejection reaches that
  route's error boundary and is answered 500 where the platform expected an acknowledgement. `parseInbound` returning `null`
  is unchanged and still the right contract — only the stated reason was wrong, and it was reaching
  users through the `.d.ts` on hover.

  `@theokit/gateway-sms`'s docblocks also named the wrong seam. Its `parseInbound` is
  `(options, ctx)`, and the `SignatureContext` it needs carries the raw body, the headers and the URL
  — none of which TheoKit's `ChannelMessage` provides, so the signature check cannot be performed
  from inside `onMessage` for any provider. SMS goes through its own `createWebhookServer`, and the
  published `.d.ts` says so now instead of claiming to be the gateway half of the channel seam.

## 0.2.1

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

## 0.2.0

### Minor Changes

- `parseInbound` — translate a raw webhook payload without re-declaring the platform's wire format.

  An app receiving a message through TheoKit's channel seam gets `payload: unknown` and, until now,
  had to parse it by hand. Measured against the published packages: wiring Telegram took 35 lines, 27
  of them the app re-declaring Telegram's own format — that `caption` is the fallback for `text`, that
  `message_thread_id` distinguishes a forum topic. It is now 13 lines and none.

  ```ts
  import { parseInbound } from "@theokit/gateway-telegram";

  const event = parseInbound(await request.json());
  if (event !== null) console.log(event.text);
  ```

  **Telegram** — `parseInbound(payload)`. One mapping serves both this and the polling path, so a
  webhook-delivered message and a polled one cannot produce different events.

  **SMS** — `parseInbound(options, ctx)`. Takes the adapter options an app already holds, because
  parsing is provider-specific and, for Twilio, country-dependent. `createBackend` runs outside the
  error boundary, so an unsupported backend surfaces instead of becoming the same `null` a malformed
  body produces.

  Both return `null` and never throw. `onMessage` runs after TheoKit has already answered 200, so a
  throw there is an unhandled rejection with no status left to change. Every field either translator
  copies is narrowed at the boundary: a payload with `text: 5` yields `text: ""`, and one with a
  non-finite `date`, `message_id`, `chat.id`, thread id, sender id or reply id is rejected or dropped
  rather than producing an event whose declared types are lies.

  `@theokit/gateway-line` and `@theokit/gateway-whatsapp` already shipped this shape and are unchanged.

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

- 82a5099: **A webhook dispatch that rejects no longer ends the process.** Both servers answer the provider before running the handler — deliberately, because LINE and the SMS providers retry a webhook they did not see a 200 for, and waiting on a slow handler turns latency into a duplicate delivery. The cost of answering early is that the dispatch is floated, and a floated rejection is an unhandled one, which terminates Node. It is now caught and written to stderr.

  This is the same defect that was fixed across the other adapters in #41; these two were missed because the gate that catches it only recognised the shape `void this.…`, and both float through a local (`void adapter.dispatch…`). The gate now matches any floated call, which is how these two surfaced.

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

### Added — `@theokit/gateway-sms@0.1.0` (ADRs D389-D396)

- Initial release of the SMS platform adapter for `@theokit/gateway`.
- Multi-backend opt-in: Twilio + Plivo + Vonage (D389). Each peer-dep is optional; install only what you use.
- `SMSAdapter` extending `BasePlatformAdapter` with:
  - `connect()` / `disconnect()` lifecycle (idempotent)
  - `sendMessage()` outbound with multipart `(i/N)` segmentation up to 1600 chars per part (D393), Intl.Segmenter surrogate-safe
  - `onInbound()` subscription (single-handler replace semantics — EC-H)
- `createWebhookServer()` Express helper with per-backend routes (`/sms/twilio`, `/sms/plivo`, `/sms/vonage`) and per-backend HMAC signature validation (D392) — rejects with 401 BEFORE handler dispatch.
- Constructor enforces signing secret (EC-1 absorbed): missing `authToken` throws `ConfigurationError` at construction time, never permits unsigned mode.
- `normalizeE164(input, defaultCountry?)` strict phone normalization via `libphonenumber-js` (D391). Accepts mobile + toll-free US numbers (EC-6).
- `splitForSMS(text, limit=1600)` UTF-16 / grapheme-cluster safe segmentation (EC-7).
- Tracks `SMSInbound` → `SMSMessageEvent` normalization with E.164 enforcement.
- No threading model: SMS conversations are flat per phone-pair (D394). `channel.type` always `"dm"`.
- MMS, group SMS, and budget-charge-per-message are deferred to v0.2 (D395, D396).
