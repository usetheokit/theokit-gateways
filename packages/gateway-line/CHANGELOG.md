# Changelog

## 0.5.1

### Patch Changes

- 6329554: The LINE and SMS webhook routes answer 413 to a request body over 1 MiB instead of buffering it without limit before the signature check.
- bca7cfd: Raise the `@theokit/gateway` peer floor to the core version that ships the APIs this adapter imports, so npm no longer installs it next to a core it cannot load.

## 0.5.0

### Minor Changes

- 458c34c: Wire channels from descriptors, and keep the channels that connect when another cannot.

  `@theokit/gateway` exports `createChannels` and the types `ChannelDescriptor`,
  `ChannelConfigField`, `ChannelWebhook`, `WebhookRequest`, `IngestResult`, `ChannelEntry`,
  `ChannelRejection` and `CreateChannelsResult`. `createChannels(entries)` builds an adapter per
  entry and returns `{ adapters, rejected }`: an entry whose required field is absent, `null` or
  `""` is rejected with a `GatewayConfigurationError` coded `missing_required_config` naming the
  keys, and a configuration error thrown by the descriptor's `create` is rejected the same way. Any
  other error propagates. It connects nothing and makes no network call.

  `GatewayRunner` accepts `connectFailure: "rollback" | "isolate"` (exported as `ConnectFailure`),
  and `StartResult` is exported.
  The default, `"rollback"`, is unchanged: one failed connect disconnects the adapters that did
  connect and rejects `start()`. Under `"isolate"`, `start()` connects every adapter, wires inbound
  only for the ones that connected, and reports the rest with a redacted reason.

  `start()` now resolves a `StartResult` (`{ connected, failed }`) instead of `void`, under both
  values. This is a type change: code that awaits `start()` and ignores the value is unaffected,
  but a structural type declaring `start(): Promise<void>` that a `GatewayRunner` is assigned to
  fails with TS2322, and a subclass overriding `start()` with that signature fails with TS2416.

  `@theokit/gateway-telegram` exports `telegramChannel`, a socket channel whose config has a
  required, secret `token` and an optional `allowedUsers`, and a `ConfigurationError` (a
  `GatewayConfigurationError` with the `gateway-telegram` prefix). Called directly,
  `telegramChannel.create` refuses a token that is not a string or is empty, and an `allowedUsers`
  that is not an array of strings; through `createChannels`, an absent or empty token is rejected
  first, as `missing_required_config`.

  `@theokit/gateway-line` exports `lineChannel`, a webhook channel whose `webhook.verify` checks the
  `x-line-signature` header against the raw body and whose `webhook.ingest` dispatches a verified
  payload through `dispatchWebhookBody`, so a reply uses the cached reply token, or answers
  `"malformed"` without dispatching. It answers `"no_handler"` (a member of `IngestResult`) when the
  payload holds a text message for the handler and none is subscribed: before the runner started,
  after it stopped, or when LINE's connect failed under `"isolate"`. Before, such a request answered
  `"delivered"`, a route acknowledged it, and LINE did not redeliver the lost message.
  `lineChannel.create` checks field types before the adapter's constructor.

  `LineAdapter.dispatchWebhookBody` now resolves `"ok" | "no_handler"` instead of `void`. It answers
  `"no_handler"`, dispatching nothing and caching no reply token, for a batch holding a text message
  that passes the mention guard while no handler is subscribed; an empty or follow-only batch still
  answers `"ok"`. It reads the handler once per batch, so a handler that unsubscribes while handling
  one event still receives the rest of the batch. Code that ignores the value is unaffected; a
  subclass overriding the method with `Promise<void>` fails with TS2416. `createWebhookServer` is
  unchanged and still answers 200 before it dispatches.

  Both descriptors are typed locally and import nothing `@theokit/gateway` 0.9.0 lacks, so the peer
  range stays `>=0.9.0 <1.0.0`.

### Patch Changes

- e5a2603: Group messages that do not mention the bot are no longer delivered by default on Discord, Matrix
  and Teams; pass `requireMention: false` to keep the old behaviour.

  Discord, Matrix and Teams gain a `requireMention` option that defaults to `true`. With it on, a
  group or thread message reaches the handler only when it mentions the bot, and a DM always does.
  Discord reads the bot's id in `mentions.users` (a direct mention or a reply that pings it; not
  `@everyone`, `@here` or roles), and drops group messages with one stderr line until the client is
  ready. Matrix reads `m.mentions.user_ids`, and falls back to the full user id in `body` or
  `formatted_body` when a client sends no `m.mentions`. Teams reads `mention` entities against the
  activity's `recipient.id`, and drops a group activity that names no recipient with one stderr line.

  LINE's `deliver()` now applies the mention guard its webhook route already applied.

  On all four adapters `deliver()` and the adapter's own inbound path use one rule, and `deliver()`
  answers `"ok"` for an event the rule drops, with or without a handler subscribed.

- 3f1788d: Send an image from a gateway handler, and refuse it wherever a platform cannot show one.

  `@theokit/gateway` exports `OutboundAttachment` (`kind: "image"`, `mediaType`, `data`, optional
  `filename`). `OutboundMessage` gains an optional `attachments` list, `ctx.reply(text, { attachments })`
  carries it to the adapter (an empty list is left out), and `BasePlatformAdapter` declares
  `supportsAttachments`, `false` by default. `DeliveryRouter.send` takes the same `attachments`
  field. The runner and the router refuse an outbound carrying attachments as
  `attachments_unsupported`, with no `sendMessage` call, when the adapter does not declare
  `supportsAttachments`.

  `@theokit/gateway-telegram` reports `supportsAttachments: true` and sends each image through
  `sendPhoto`, the text as the first photo's caption up to 1024 UTF-16 units and after the photos
  when longer. A non-image kind is refused as `attachments_unsupported`; a missing image, more
  than 10 images or an image over 10 MiB as `invalid_attachment`; all with no request.

  Every other adapter, and every adapter's `editMessage`, refuses an outbound carrying attachments
  with `attachments_unsupported` and makes no platform call, instead of sending the text and
  dropping the image.

  The runner's auto-reply to a blocking `pre_inbound` hook no longer discards a `sendMessage` that
  throws: the error reaches the `on_error` hooks with the event and is written to stderr, redacted,
  as a handler error is. Dispatch still does not throw.

- e980fb8: `@theokit/gateway` exports `SeenIds` (a bounded set of delivered ids) and `splitKeepingRows` (a
  grapheme-safe split that keeps Markdown table rows whole). The SMS and LINE adapters import
  `splitKeepingRows` instead of carrying copies; their peer floor is now `>=0.13.0`.
- e9be726: Keep Markdown table rows intact through translation and splitting.

  `channelRendering(platform).translate` and `toDialect` now rewrite a table row (a line whose first
  non-blank character is `|`) one cell at a time. Before, an emphasis span could open in one cell
  and close in the next, so `| 2 x *a | b* y |` lost both stars on the ten platforms that rewrite
  markers. Text where no span crosses a row's pipe translates exactly as before. A lone `\r` counts
  as a line ending, as in GFM. Inline code that holds an unescaped pipe inside a row is split at
  that pipe, as GFM splits the cell, so its backticks no longer pair and the platforms that strip
  markers now keep them.

  `splitForLine` and `splitForSMS` no longer cut a table row in two at a part
  boundary. When a cut would fall inside a row that fits in one part, the part ends before that row
  and the row starts the next part. A row longer than a part is still cut by length. Every
  character is kept, and every part stays within its limit (with the `(i/N) ` prefix counted on
  SMS, whose numbering follows the new part count) except a single grapheme longer than the limit,
  which is emitted whole as its own part, as before. Text with no table row splits exactly as
  before. Two rows that each fill a part exactly arrive as three parts, the second holding only the
  line ending between them.

  No export, signature, dependency or peer range changes.

## 0.4.0

### Minor Changes

- 39d06f8: Wire channels from descriptors, and keep the channels that connect when another cannot.

  `@theokit/gateway` exports `createChannels` and the types `ChannelDescriptor`,
  `ChannelConfigField`, `ChannelWebhook`, `WebhookRequest`, `IngestResult`, `ChannelEntry`,
  `ChannelRejection` and `CreateChannelsResult`. `createChannels(entries)` builds an adapter per
  entry and returns `{ adapters, rejected }`: an entry whose required field is absent, `null` or
  `""` is rejected with a `GatewayConfigurationError` coded `missing_required_config` naming the
  keys, and a configuration error thrown by the descriptor's `create` is rejected the same way. Any
  other error propagates. It connects nothing and makes no network call.

  `GatewayRunner` accepts `connectFailure: "rollback" | "isolate"` (exported as `ConnectFailure`),
  and `StartResult` is exported.
  The default, `"rollback"`, is unchanged: one failed connect disconnects the adapters that did
  connect and rejects `start()`. Under `"isolate"`, `start()` connects every adapter, wires inbound
  only for the ones that connected, and reports the rest with a redacted reason.

  `start()` now resolves a `StartResult` (`{ connected, failed }`) instead of `void`, under both
  values. This is a type change: code that awaits `start()` and ignores the value is unaffected,
  but a structural type declaring `start(): Promise<void>` that a `GatewayRunner` is assigned to
  fails with TS2322, and a subclass overriding `start()` with that signature fails with TS2416.

  `@theokit/gateway-telegram` exports `telegramChannel`, a socket channel whose config has a
  required, secret `token` and an optional `allowedUsers`, and a `ConfigurationError` (a
  `GatewayConfigurationError` with the `gateway-telegram` prefix). Called directly,
  `telegramChannel.create` refuses a token that is not a string or is empty, and an `allowedUsers`
  that is not an array of strings; through `createChannels`, an absent or empty token is rejected
  first, as `missing_required_config`.

  `@theokit/gateway-line` exports `lineChannel`, a webhook channel whose `webhook.verify` checks the
  `x-line-signature` header against the raw body and whose `webhook.ingest` dispatches a verified
  payload through `dispatchWebhookBody`, so a reply uses the cached reply token, or answers
  `"malformed"` without dispatching. It answers `"no_handler"` (a member of `IngestResult`) when the
  payload holds a text message for the handler and none is subscribed: before the runner started,
  after it stopped, or when LINE's connect failed under `"isolate"`. Before, such a request answered
  `"delivered"`, a route acknowledged it, and LINE did not redeliver the lost message.
  `lineChannel.create` checks field types before the adapter's constructor.

  `LineAdapter.dispatchWebhookBody` now resolves `"ok" | "no_handler"` instead of `void`. It answers
  `"no_handler"`, dispatching nothing and caching no reply token, for a batch holding a text message
  that passes the mention guard while no handler is subscribed; an empty or follow-only batch still
  answers `"ok"`. It reads the handler once per batch, so a handler that unsubscribes while handling
  one event still receives the rest of the batch. Code that ignores the value is unaffected; a
  subclass overriding the method with `Promise<void>` fails with TS2416. `createWebhookServer` is
  unchanged and still answers 200 before it dispatches.

  Both descriptors are typed locally and import nothing `@theokit/gateway` 0.9.0 lacks, so the peer
  range stays `>=0.9.0 <1.0.0`.

## 0.3.0

### Minor Changes

- a2fb95e: Widen the platform SDK peer ranges, each major verified against the real platform.

  `gateway-matrix` accepts `matrix-js-sdk ^32.0.0 || ^42.0.0`, and `gateway-line` accepts
  `@line/bot-sdk ^9.0.0 || ^11.0.0`.

  For Matrix this is a security fix for consumers rather than a convenience. The old `^32.0.0`
  floor could not reach any version carrying the five advisories' fixes — including a HIGH, where
  key history sharing could share keys to malicious devices, fixed in `>=34.8.0`. A consumer could
  not patch it alone: raising their own dependency put them outside the range this package
  declared.

  Both majors of both ranges were exercised against the real platform, not only typechecked. The
  Matrix live contracts pass 7/7 against a Synapse homeserver at 32.4.0 and at 42.2.0, with
  per-test timings within 5ms of each other; the LINE live contracts pass 6/6 against the real
  LINE API at 9.9.0 and at 11.2.0.

  Each package now declares the SDK as an explicit devDependency. Until now neither did, so what
  their suite ran against was whatever pnpm's peer auto-install happened to pick — the test target
  was an accident rather than a decision.

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

### Patch Changes

- 4b1d4bb: The half of an Express webhook server that is the same everywhere now lives in one place (#89).

  `gateway-line` and `gateway-sms` each shipped one and shared 101 of ~170 lines: the lazy `express`
  load, the raw-body capture with the hang it documents, and the start/stop lifecycle. What differs —
  signature verification, body parsing, routing — stayed where it belongs.

  It had already been paid for. A write-once latch made `start()` after `stop()` return without
  creating a listener, which is a port nothing answers on with no error and no log, and the fix had to
  be applied to both files by one commit because the latch lived in the copied half.

  `@theokit/gateway` now exports `loadPeer`, `rawBodyCapture` and `listenerLifecycle`. **This does not
  make express a dependency of the core**: nothing in that module imports it. Every shape is
  structural — a request is whatever has `readableEnded` and `on`, a listener is whatever has `listen`
  and `close` — so the two packages that use express keep declaring it and the core never learns the
  name.

  Every adapter README now states how inbound reaches it (#91): a webhook the application must
  authenticate, a WebSocket, a sync loop, or an SDK that owns its own HTTP server. The three that have
  no webhook say so with the reason, because an absence that is a decision should not read as a gap.

## 0.1.6

### Patch Changes

- 5e346e1: The webhook server can be started again after being stopped.

  `started` and `stopped` were write-once. After a `stop()`, `start()` hit `if (started)` and returned
  without creating a listener — so the server was silently dead: no error, no log, just a port nothing
  answers on. The next `stop()` was a no-op for the same reason, in the other direction.

  Anything that restarts a gateway — a config reload, a reconnect after a network fault, a supervisor
  cycling the process in-band — got a server that reported success and served nothing.

  Fixed in commit 11000cc on 2026-08-29; this changeset was missing, so the fix would have stayed
  unreleased and npm would have gone on serving the broken code.

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

### Added — `@theokit/gateway-line@0.1.0` (ADRs D405-D412)

- Initial release of the LINE Messaging API adapter for `@theokit/gateway`.
- `@line/bot-sdk@^9.0.0` peer-dep (lazy import + signature support).
- Webhook-only transport (D406) — `createWebhookServer({ adapter, path, port })` with raw-body capture, HMAC-SHA256 signature middleware (D408), and 401 BEFORE handler dispatch.
- LineAdapter extends BasePlatformAdapter:
  - `connect()` validates channel secret + channel access token (D414 mirror).
  - `sendMessage()` uses **reply token first**, falls back to push API after token expiry (D407). Per-userId LRU cache (1000 entries, 60s TTL, one-shot consume).
  - `splitForLine()` 5000-char surrogate-safe split (D411, EC-7 pattern).
  - `onInbound()` replace semantics (EC-H).
- Mentionee handling (D409, EC-2 absorbed): `event.message.mentionees[]` extracted to `event.line.mentionees` (userId list, never inline `@text` confusion).
- Source-type mapping (D410): `user` → `dm`, `group`/`room` → `group`. No threads in v0.1.
- EC-4 absorbed: webhook delivers 9 event types (`message`, `follow`, `unfollow`, `join`, `leave`, `postback`, `beacon`, `accountLink`, `things`). `normalize.ts` filters `event.type !== "message"` AND `event.message.type !== "text"` at the top — no TypeErrors on non-text events.
- Signature middleware uses `crypto.timingSafeEqual` (D408).
- Flex Message + Carousel deferred to v0.2 (D412) — caller can drive via `adapter.getClient().pushMessage(...)` escape hatch.
