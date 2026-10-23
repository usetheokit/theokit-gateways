# Changelog

## 0.4.0

### Minor Changes

- 05e7fdd: Edit a message an adapter sent, so a reply can stream as a preview that the final text replaces.

  `BasePlatformAdapter` gains `supportsEdit` (`false` by default) and
  `editMessage(messageId, out)`, whose default refuses with `edit_unsupported`, makes no platform
  call and never throws. A third-party subclass that already declares a member with either name and
  a different type no longer compiles against this release, and under `noImplicitOverride` one
  that declares it without `override` does not either.

  Telegram (`editMessageText`), Discord (one REST `PATCH` of the message, without fetching the
  channel), Slack (`chat.update`), Mattermost (`patchPost`), Matrix (an `m.replace` event) and Teams
  (`updateActivity`, or `activities(conversationId).update` on `@microsoft/teams.api` below 2.0.14)
  set `supportsEdit` to `true` and replace the text of a message they sent, honouring `format` as
  `sendMessage` does (Slack's `chat.update` takes no `mrkdwn` argument, so its edit sends the text
  as it is for every format), and return `{ ok: true, messageId }` with the same id. E-mail, SMS, LINE and
  WhatsApp keep the default.

  An edit is refused with no request as `edit_too_long` when the text would need more than one
  platform message (Matrix has no length check), as `invalid_message_id` for an empty id (and on
  Telegram one that is not a safe positive integer), and as `empty_text` and `not_connected` where
  `sendMessage` answers those. Telegram answers its "message is not modified" refusal as a success.
  On Discord an unknown channel is answered by the platform, as `discord_10003`. On Matrix a
  `#alias` the adapter never resolved costs one lookup before the edit. Teams and Matrix do not
  retry a refused markup as plain text on an edit, as they do on a send.

  The six adapters keep `>=0.9.0` as their peer range on `@theokit/gateway` in this release. At run
  time they work against any core in that range, since no adapter calls the base `editMessage`. Their
  sources declare both members with `override`, so building them against a core older than this one
  reports TS4113. The floor rises to this core in the next release, once it is on npm
  (`docs/adr/0008-edit-capable-adapters-raise-their-core-floor-after-the-core-ships.md`). A
  consumer's own typecheck reads the published declarations, which carry no `override`, and passes
  on an older core.

## 0.3.0

### Minor Changes

- 86fed0c: Export `teamsActivityVerifier`, which checks an inbound Teams activity on a route the app owns,
  and its types `TeamsActivityVerifierOptions`, `TeamsActivityVerifyResult` and
  `TeamsCloudEndpoints`. Additive: no existing export changes, and no new dependency (`node:crypto`
  only).

  `teamsActivityVerifier({ clientId, tenantId?, cloud? })` returns a function that reads a Fetch
  `Request`, consuming its body, and answers `{ ok: true, activity, token }` or
  `{ ok: false, reason, message }`. It never throws for a request, and a refusal's message never
  contains the token. It accepts an activity only when:

  - the token's RS256 signature verifies under a key Microsoft publishes, checked by the verifier
    itself before the Teams SDK is asked, so a forged token never makes the bot fetch a key set;
    a genuinely signed token issued for another app, or expired or not yet valid by more than the
    SDK's 300-second tolerance, is refused as `invalid_token` at that point too, because the SDK
    reads a key before it checks those claims; and on SDK 2.0.x, whose validator cannot accept a
    tenant-issued (Entra) token, such a token is `invalid_token` before any key set is read, since
    2.0.x would download the whole Bot Framework key set for it on every request and then refuse it;
  - the Microsoft SDK's own token validator accepts the token, so issuer, audience and expiry stay
    Microsoft's rules;
  - the token's `aud` is this bot's app id, its `serviceurl` matches the activity's `serviceUrl`,
    and its tenant is the configured one;
  - the activity's `channelId` is `msteams`. A connector token is issued for the bot, not for one
    channel, so a genuine token also arrives from the bot's Web Chat and Direct Line channels, where
    the client sets `from` and `channelData`.
  - the Bot Framework key that signed the token is endorsed for the activity's channel: its published
    `endorsements` list the `channelId`. The signer writes the `channelId`, so without this a key
    Microsoft endorses only for another channel could sign an activity that says `msteams`. A key
    with no `endorsements` is endorsed for nothing, and such a token is `invalid_token` before the SDK
    is asked. Tenant (Entra) keys carry no endorsements and are not judged by them.

  A refusal carries one of eleven reasons: `missing_authorization`, `malformed_body`,
  `body_already_read`, `validator_unavailable`, `invalid_token`, `key_set_unavailable`,
  `audience_mismatch`, `serviceurl_mismatch`, `channel_mismatch`, `tenant_mismatch` and
  `tenant_unverified`. Three of them are not the sender's fault: `key_set_unavailable` and
  `validator_unavailable` mean the verifier could not judge the token and a retry may succeed (the
  README route answers 503), and `body_already_read` means something read the request body before
  the verifier, which no retry clears (500). The README route logs the reason of every refusal.

  The verifier reads Microsoft's key sets itself: the Bot Framework set, and with `tenantId` that
  tenant's set. It reads a set when it holds no copy or its copy lacks the token's `kid`, and in the
  background once its copy is an hour old, answering from that copy meanwhile. No read starts within
  10 seconds of the end of the previous one, per set, whatever is sent, and both intervals are
  measured on the monotonic clock. A failed read keeps the last good copy; a document listing no
  usable RSA key counts as a failed read, and so does a redirect or a response that throws
  while it is read; the request waiting on that read is answered `key_set_unavailable`, not a
  rejected promise. A `key_set_unavailable` message
  names the set, its URL and why its latest read failed. When the SDK, which still reads the key
  through its own client, reports that it could not read it, the answer is also
  `key_set_unavailable`.

  It reads at most 1 MiB of body before any token work; a larger body, one that fails part-way, a
  POST with no body, or a body that is not a JSON activity with a `serviceUrl` is `malformed_body`.
  It hands the SDK validator a silent logger, so a refused token writes nothing to the host's logs.
  A failed SDK load is kept, and that verifier refuses every request as `validator_unavailable`
  until it is rebuilt.

  Construction throws a `TypeError` for an empty `clientId`; an empty `tenantId` or one of `common`,
  `organizations` and `consumers`; a `tenantId` that is not a tenant GUID, such as a domain, which
  no token's `tid` claim can equal; a `cloud` missing one of its three endpoints or with one that is
  not an `https:` URL (`http:` is accepted only on `localhost`, `127.0.0.1` and `[::1]`); a
  `cloud.loginEndpoint` ending in a slash; and a `cloud.openIdMetadataUrl` that does not end in
  `/openidconfiguration`. The verifier reads each option once and validates that frozen copy, so
  changing the options object afterwards does not reach the SDK validator, which is built on the
  first request, and a `cloud` endpoint inherited from a prototype or served by a getter is the value
  both checked and used. The options take no other field: the SDK validator always comes from the
  installed `@microsoft/teams.apps`, and nothing on the options object or its prototype can stand
  in for it.

  Two refusals are deliberate: with `tenantId` set, a Bot Framework token with no `tid` claim is
  `tenant_unverified`, and Microsoft documents none on connector tokens; an agentic-identity (Entra)
  activity is `serviceurl_mismatch`, because its token carries no `serviceurl` claim. ADR-0003 and
  ADR-0005 record the decisions.

## 0.2.1

### Patch Changes

- 1e215ab: The peer floor on `@theokit/gateway` is `>=0.9.0`, which is what these packages have needed since
  they gained `deliver`.

  `deliver` and `runHandler` arrived in the core at 0.9.0, and the previous release shipped these
  adapters still declaring `>=0.6.0` — a floor `dep-check` had already proven false by building the
  workspace against it: TS4113 on the override, TS2551 on `runHandler`, in all ten packages.

  It could not be corrected in that release. `dep-check`'s install check packs an adapter and installs
  it the way a consumer would, and until 0.9.0 was on npm no consumer could resolve a package asking
  for it — the check was right about the world as it stood. The floor is raised here, against a
  registry where the version it names exists.

  Between the two releases a consumer installing against an older core got a build error rather than a
  resolution error: the same failure, later and less clearly. That window is closed.

## 0.2.0

### Minor Changes

- b38172b: **The peer floor on `@theokit/gateway` rises with this release.** Every adapter now implements
  `deliver` over `runHandler`, and neither exists in an older core — an adapter installed against one
  does not build. `dep-check` caught that by building the whole workspace against the floor each
  package claimed, which is the one thing a version range cannot tell you by reading it.

  The floor is set in the version commit rather than here, because a range cannot name a version that
  does not exist yet: raised in the workspace, the same gate then fails the other way round — every
  adapter declaring a floor above the core installed beside it. That is the shape `fa70153` used when
  these ranges were first written.

  `deliver(event)` — every adapter can now be handed an event that arrived out of band (#83).

  `onInbound` was the seam every adapter implemented and it had no public counterpart. Six platforms
  self-deliver once connected — long polling, a gateway socket, Socket Mode, a sync loop, IMAP — so
  the asymmetry stayed invisible: `GatewayRunner` worked for eight platforms and silently did nothing
  for LINE and WhatsApp Cloud, whose payloads arrive on an HTTP route the application owns. Every app
  wired those two by hand, beside the runner rather than through it.

  ```ts
  const outcome = await adapter.deliver(event); // "ok" | "no_handler" | "handler_threw"
  ```

  The three outcomes are distinguished because a caller acts on them differently: answering a webhook
  200 when nobody was subscribed tells the provider to stop retrying a message nothing received.

  `BasePlatformAdapter.runHandler` holds the containment once, where ten copies of it used to live —
  a handler is user code, its throw is named as the handler's failure rather than the platform's, and
  delivery continues. Each adapter's `deliver` is one line over it.

  Also: `gateway-sms`'s `createWebhookServer` now signs against the configured `publicUrl` (#90).
  Twilio verifies against the URL it POSTed to, and behind a proxy that rewrites `host` — a tunnel, an
  ingress, a load balancer terminating TLS — the reconstruction from headers yields the internal
  address, so a correct signature fails on every delivery. `publicUrl` is required by all three
  backend option shapes and documented as "used by signature verifier"; until now no source file read
  it. The header reconstruction stays as the fallback for an app served directly.

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

### Added

- Initial package skeleton (Roadmap v1.4 #3).
- `TeamsAdapter` extending `BasePlatformAdapter` (ADRs D315-D326).
- Built on `@microsoft/teams.apps@^2.0` SDK (D315). Modern Microsoft-published library replacing legacy `botbuilder`.
- `getExpressAdapter()` returns the SDK's `ExpressAdapter` wired into a user-supplied Express app (D316, D326).
- Inbound normalization: 1:1 / group chat / channel post → `TeamsMessageEvent` with portable fields + `event.teams.raw` escape hatch (D318, D320).
- Outbound: `app.send(conversationId, activity)` — string conversation id only (no `ConversationReference` plumbing required by SDK v2).
- Mention stripping via SDK's built-in `mentions.stripText: true` option (D321 + EC-9).
- `splitForTeams` 8000-char message splitter (D322) with UTF-16 surrogate guard.
- `mapTeamsError` HTTP / plain-Error mapper (D300 pattern, EC-7).
- Channel type mapping (D318): `personal → dm`, `groupChat → group`, `channel → group + topicId`.
- Constructor validates non-empty credentials at construction time (EC-1).
- Default arm for unknown `conversationType` — no crash on system activities (EC-3).
- Sender fallback chain: `from.id ?? from.aadObjectId ?? "anonymous"` (EC-4).
- Error mapper tolerates plain `Error` without `.status` (EC-7).
