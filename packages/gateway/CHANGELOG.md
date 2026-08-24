# Changelog

## 0.7.1

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

## 0.7.0

### Minor Changes

- 74a79b5: A gateway can now be authored, published and consumed outside this repository.

  `PlatformName` and `MessageEvent` derive from a new exported `PlatformEventRegistry`, an interface
  other packages extend through TypeScript declaration merging:

  ```ts
  declare module "@theokit/gateway" {
    interface PlatformEventRegistry {
      signal: SignalMessageEvent;
    }
  }
  ```

  Exhaustive narrowing survives, including over platforms the core has never heard of: forget a
  `case` for a third-party platform and the build breaks, exactly as it does for the ten shipped
  here. A misspelled platform name is still a compile error — the union is opened to extension, not
  to arbitrary strings.

  Both sides of an augmentation are gated. An entry typed `any`, registered under an index signature,
  carrying a non-literal discriminator, or disagreeing with its own key is excluded rather than
  admitted. Each of those was measured to break narrowing for **every** consumer before the guards
  existed — an index signature made the whole union resolve to `never`, and an optional entry injected
  `undefined` into it. Twelve augmentation shapes are compiled in CI against the published
  declaration to keep it that way.

  **Behaviour change:** `BaseMessageEvent.platform` is now `string` rather than `PlatformName`. Every
  concrete variant still narrows it to its own literal, so code holding a `MessageEvent` is
  unaffected. Code that assigns `.platform` off a bare `BaseMessageEvent` into a `PlatformName` slot
  will need a narrowing step. This is required by the derivation: `PlatformName` now comes from the
  guarded union, and naming it on the base would make the two reference each other.

  See `docs/adr/0002-platform-event-registry.md`, which supersedes `docs/adr/0001-message-event-closed-union.md`.

## 0.6.1

### Patch Changes

- b631af7: **The integration bootstrap scripts now name reused container state as the cause.** Both create a server and then create accounts inside it, so both are idempotent only against a _fresh_ container. Run either against one that survived a previous run and it fails in a voice that does not name the cause — and Matrix's is actively misleading:

  ```
  matrix:      register theokit-bot failed: {… "error":"Invalid registration token"}
  mattermost:  create first user failed (400): An account with that username already exists.
  ```

  The token was read from the log and sent correctly. It is "invalid" only because the server consumed it at its first boot, so the message sends the reader hunting the one thing that is not wrong. Measured: two round-trips before the remedy — a `:down` — became obvious, and the remedy is one command.

  Each failure now prints it, and only when the failure actually matches a reused-state signature. Attaching the advice to every failure would send someone to recreate a container over a network blip and would train them to skip the line, which is how a helpful message becomes noise.

  The decision is a pure function with its own tests, kept out of both scripts: the scripts boot containers and call `process.exit`, so they are untestable by construction, and "is this reused state?" is the only part with a right answer.

- 58d302e: **A behavioural conformance suite now runs the `PlatformAdapter` contract against all nine credential-based adapters at once**, in `integration/tests/unit/`. It needs no credential and no network — every assertion is about what an adapter does _before_ it connects, because a conformance suite that needs provisioning is a conformance suite that does not run.

  The existing cross-adapter gate reads source text, which is the right tool for what it catches and the wrong one for this. Getting that file honest took five attempts in this repository, four of which passed while checking nothing: a regex matching zero declarations, a window reaching into the neighbouring method and accepting its guard, a brace matcher fooled by a string literal, a floor that only fired when the count dropped. Each was a statement about text that read like a statement about behaviour.

  What the new suite asserts, per adapter: it declares the platform it is (the routing key — an adapter naming itself wrong is silently unreachable rather than broken); `disconnect()` on one that never connected resolves rather than throwing, and again on a second call; and the unsubscribe `onInbound` returns is safe to call twice. All nine conform today, verified by mutation — a wrong `platform`, a throwing `disconnect()`, and an `off()` that throws on reuse each fail it.

  One invariant is **deliberately absent and says so in the file**: "a stale unsubscribe does not deafen a live subscription". It was written, it passed, and mutation showed it could not fail — the only assertion available without a connection is that `onInbound` returns a function, which holds either way. It stays covered textually for all ten and behaviourally for WhatsApp, whose adapter takes a backend and therefore has a dispatch seam. A file arguing that behaviour beats text should not make the argument with an assertion that cannot fail.

## 0.6.0

### Minor Changes

- 08abaed: **`GatewayRunner.stop()` is now terminal, and says so instead of leaving a runner nothing can stop.**

  `start()` and `stop()` were each written to be idempotent, but they guarded on different flags. `stop()` cleared `connected` and set `stopped`; nothing ever cleared `stopped`. So a second `start()` sailed past its `connected` guard, reconnected every adapter and rewired inbound dispatch — while the next `stop()` returned at its own `stopped` guard without disconnecting anything. Measured on the previous release: two connects, one disconnect, and a live inbound handler that no call could take down.

  Nothing reported this. The adapters stayed connected, the events kept arriving, and both methods returned normally. A process that reloads configuration or reconnects after a network failure by restarting the runner leaked a connection every cycle.

  `start()` on a stopped runner now throws `GatewayLifecycleError` with `code: "runner_stopped"`, and the message says to construct a new runner. That is the whole of the behaviour change: a call that previously appeared to succeed while corrupting state now fails at the call that cannot be honoured, which is the only point where a caller can still do something about it.

  Adds `GatewayLifecycleError` and `GatewayLifecycleErrorOptions` to the public API. It is deliberately separate from `GatewayConfigurationError`: that one reports a bad setting, this one reports a fine setting used at an impossible moment.

- 66e08ba: **A third WhatsApp backend: `WhatsAppBaileysBackend`.** It speaks the WhatsApp Web multi-device protocol over a WebSocket. Where the `web` backend drives a headless Chromium through `whatsapp-web.js`, this holds a socket — that is the whole difference in kind.

  Reach it with `WhatsAppAdapter.fromBaileys({ sessionDir })`, or through `WhatsAppAdapter.from({ backend: "baileys", baileys: { … } })` when the choice arrives as configuration rather than as a decision in code. `baileys` is an **optional peer dependency** (`>=7.0.0-rc14`), loaded lazily at connect: a consumer who never constructs this never needs it installed.

  **Added rather than replacing**, for three reasons a substitution would not give. Nobody loses a paired session — a Puppeteer profile and a multi-file auth state are not interchangeable. The comparison against the incumbent becomes measurable rather than asserted, which is the whole point: no comparison has been made yet, and this changeset does not claim one. And retreat stays cheap, because nobody is forced onto it.

  **Unofficial, and no amount of code changes that.** It automates a WhatsApp Web session, which Meta's terms do not sanction and which can get a number banned. Use a number created for this and nothing else, never a personal one.

  Three decisions worth naming:

  _Sends are serialised_ — one `sendMessage` in flight per socket, including when one times out. That last clause was not true when this was first written: the queue advanced on the raced result, and a timeout does not cancel a `sendMessage`, so a timed-out send stayed on the socket while the next one started — reaching the exact hazard the serialisation exists to prevent, through the timeout meant to bound it. A review found it; there is now a test that fails if the queue goes back to advancing on the race. Honest about provenance: both peer gateways studied do this and one records that concurrent sends on a single socket can misdeliver to the wrong chat. **We have not measured that in our own code**, so it is precaution rather than a reproduction of our own bug. Kept because the cost is one promise chain and the failure it guards against is a message reaching the wrong person.

  _A timed-out send reports undetermined delivery, and is never retried._ A local timeout says the acknowledgement did not arrive, not that the message did not; retrying can duplicate — the failure this repository already shipped once, in the email backend re-answering its inbox.

  _A connect that fails or is superseded tears its socket down._ A timed-out connect used to leave a live socket behind: it kept feeding inbound into the handler, and the retry opened a second live session — which on an unofficial automation is ban surface, not merely a leak. The same generation counter makes `disconnect()` during an in-flight `connect()` safe; without it the late success set `connected` over a backend with no socket, and every later send was refused until the object was rebuilt.

  _The backend depends on a three-member socket contract we declare_, not on Baileys' types. That is what lets every test in this backend drive a fake and run with `baileys` absent — which matters, because a backend that could only be exercised with the real library installed is a backend exercised by nothing, and that is exactly how the `web` backend reached production unable to start.

  _A retired connection attempt is ended, not merely silenced._ Retiring by generation made an abandoned attempt's listeners no-ops — including the one that resolves it — so nothing could settle it but the timeout. A `disconnect()` during pairing therefore blocked shutdown for the full 60s default while the socket it asked to close stayed live. And a socket that closed under the backend kept its reference until the next `connect()` overwrote it, so it was never ended and no later `disconnect()` could reach it. Both are fixed, as is a third window a later round found: a `disconnect()` landing while the factory itself was still awaiting — a dynamic import, the auth state off disk, and a network round-trip for the protocol version all happen before a socket exists — could not see an attempt that had no socket yet. Each has a test that fails when its fix alone is reverted.

  _A failed connect says why._ `false` with no output cannot distinguish a network blip from a device the operator unlinked from their phone, and only one of those is worth retrying — a supervisor that cannot tell them apart retries forever against a session that can only be re-paired.

  _Pairing has somewhere to go._ `printQRInTerminal` stays off — a library writing to stdout decides where a host's output goes — so the QR is handed to an `onQr` callback, defaulting to stderr. Without it a fresh session directory could only ever time out: there is no other way to pair.

  **What no test here proves.** Nothing in this repository touches WhatsApp. Pairing needs a QR scan by a human and there is no WhatsApp in Docker, so protocol conformance, delivery, receipts and ban behaviour are unproven by this changeset and by every gate in this repository. A green suite means our logic does what we think — not that WhatsApp agrees.

  The socket contract this backend depends on lost a member: `logout()` was declared and called by nothing, and on WhatsApp `logout()` **unpairs the device** — the opposite of what `disconnect()` means here. A dead member advertising a destructive capability is worse than an absent one.

  `WhatsAppMessageEvent.whatsapp.backend` and `WhatsAppBackend.kind` gain a third member, so an exhaustive `switch` over either stops compiling until the case is handled. No call site in this repository switches on them.

### Patch Changes

- e682180: **A message whose handler throws no longer kills the bot.** On Teams and on WhatsApp's web backend it did — not degraded delivery, an exit code. `Error: ... / Node.js v22.22.2`, and the next message never arrived.

  Both dispatched with `void handler(event)`. `void` reads as "I am not waiting for this"; what it tells the runtime is "I am not handling the error", and under Node 22's default an unhandled rejection ends the process. Measured against both adapters through their own injection seams before the fix, and again after: the throw is now contained, named, and delivery continues.

  **Discord and Telegram contained it but blamed the wrong thing.** The rejection escaped into the platform library's error channel, so a bug in the consumer's own handler surfaced as `[discord] client error` / `[telegram] bot error`. Anyone debugging that went looking in discord.js and grammy for a fault that was in their own code. Both now report `handler threw` and return `"handler_threw"` from the internal dispatch seam.

  **WhatsApp Cloud dropped the rest of the batch, and made the platform resend it.** Meta packs several messages and their delivery receipts into one webhook, and the dispatch loop awaited each handler with nothing around it. One throw skipped every remaining message in the payload, skipped the status receipts, and rejected `handleWebhookPayload` — so the caller's route answered 500 and Meta redelivered the whole batch, replaying the messages that had already been handled. That is a duplicate-reply bug reached through a different door than the one fixed in #11. The same method also now answers `false` on a signed body that is not JSON, instead of throwing out of a method whose contract is `true`/`false`.

  **Email gained a net it did not strictly need.** Its drain is written never to reject, and it does not — but both launch sites discard the promise, so that property was the only thing between a future edit and the same fatal rejection, and nothing enforced it. The catch now lives at the site that would pay for it.

  **The contract is written down, and held to.** `BasePlatformAdapter.onInbound` now states it: a handler may throw, and an adapter must contain that throw, report it as the handler's failure rather than the platform's, and keep delivering. Eight of ten adapters had converged on exactly that with nothing recording it. `tests/lint/adapter-contract.test.ts` gains two invariants — every adapter names a handler throw as the handler's, and no adapter launches a user callback with a bare `void` — and both were checked against a deliberately reverted adapter to confirm they fire rather than pass vacuously.

- 9c35372: **Slack now answers `empty_text` for empty text, like the other nine adapters.** The contract states it without a condition — `sendMessage` with empty text returns `{ ok: false, code: "empty_text" }` — but Slack checked the connection first, so the same call answered `not_connected` there and `empty_text` everywhere else.

  Nobody lost a delivery over it: both results are already `ok: false`. What broke is code that branches on the code — treating a caller's bad input one way and an unavailable transport another, with a retry or an alert behind the second. Written against the contract, that code did the right thing on nine platforms and the wrong thing on the tenth, with nothing to say why.

  The connection guard keeps its reason (`this.app` is set before `app.start()` resolves, so a send in that window would otherwise leak through); only the order changed. Input first, transport second, which is what `rules/error-handling.md` § 2 asks for and what the other nine already did.

  The cross-adapter gate gains the invariant, and it is checked against a deliberately reverted adapter. That check earned its keep immediately: the first version of the invariant read a window of raw source that its own explanatory comment filled, so it passed against the reverted adapter by matching the prose describing the rule. It now strips comments before asking — a gate answered by a comment is worse than no gate, because it reports coverage it does not have.

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

- 144b2ba: **The `post_outbound` hook now fires.** It is one of the three fire points `GatewayHook` documents and exports, and no production code had ever called it: `HookExecutor.firePostOutbound` existed, was typed, was unit-tested, and had exactly one caller in the repository — its own test.

  That is the worst shape a broken contract can take. Registering a `post_outbound` hook for delivery auditing, outbound metrics or reply logging raised no error and produced no warning. The hook was simply never invoked, and the instrumentation a consumer believed they had did not exist.

  Every reply now leaves through one path that sends and then reports, so the hook fires exactly once per attempt with `{ event, outbound, result }` — including the EC-D auto-reply sent when a `pre_inbound` hook blocks with a message, and including the attempt that finds no adapter registered for the event's platform. That last case matters more than it looks: a hook counting deliveries would otherwise omit precisely the replies that went nowhere.

  The hook observes; it does not intercept. The adapter's `SendResult` reaches the caller of `reply` unchanged, and a hook that throws is contained by `HookExecutor`, so a broken observer cannot turn a delivered reply into a failed one.

- 111f837: **`stop()` no longer holds the process open for the whole drain window.** A bot that stopped on `SIGINT` sat there for ten more seconds before the process exited, with nothing running and nothing to wait for.

  `stop()` drains in-flight handlers by racing them against a `drainTimeoutMs` timer. `Promise.race` settles on whichever branch finishes first and abandons the other — but an abandoned `setTimeout` is still a scheduled timer, and a scheduled timer keeps Node's event loop alive. The drain finished in under a millisecond; the timer it beat kept the process running for the remaining ten seconds. Measured before the fix: `stop()` returned after 0 ms, the process exited after 10 001 ms. After: 1 ms.

  The delay only appeared once at least one event had been dispatched, since the drain branch is guarded on there being something in flight — which is to say, on every real bot rather than on any test that stopped a runner it had never used. Under an orchestrator that sends `SIGTERM` and then `SIGKILL`, the difference is whether shutdown is clean or forced.

  The timer handle is now cleared in a `finally`, so the cleanup does not depend on which branch of the race won.

## 0.5.1

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

## 0.5.0

### Minor Changes

- Architecture-hardening (roadmap M0–M3): three new public primitives on the core barrel, plus a hook-engine relocation. No breaking changes.

  - `chunkText(text, options)` — transport-agnostic, boundary-preferring text chunker. Single-sources the message-splitting logic the platform adapters share; reproduces the Slack-family (fixed window, space boundary, UTF-16 surrogate guard) and Telegram-family (soft window, newline-only) algorithms via options. Validates inputs (positive-integer `limit`, `safeLimit <= limit`) and throws `RangeError` on misuse (fail-fast — no infinite loop).
  - `chunkByGrapheme(text, options)` — grapheme-cluster-safe (`Intl.Segmenter`) chunker shared by the LINE/SMS adapters; never severs an emoji, regional-indicator pair, or combining sequence.
  - `GatewayConfigurationError` base + `GatewayConfigurationErrorOptions` — shared base for per-adapter `ConfigurationError` classes.
  - `HookExecutor` moved from `hooks/types.ts` to `hooks/executor.ts` (public API byte-identical; re-exported unchanged from the barrel).

## 0.4.1

### Patch Changes

- e926cd9: Align the gateway cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from `^1.9.0` to `^2.18.0` across all 11 packages. The only consumed SDK surface is `Security.redact` (in the gateway core runner) — a stable public API (ADR D68) unchanged across 1.x→2.x — so the alignment is a pin bump, not a migration. Validated: all 11 packages typecheck + build + test green against 2.18.0 (543 tests passed). No dead/unwired surfaces (`no-stubs-no-mocks-no-wired` checklist clean).

## [Unreleased]

### Changed

- **Documentation only:** added `src/README.md` documenting the 6 single-file sub-folder cluster (`adapter/`, `delivery/`, `hooks/`, `runner/`, `session/`, `types/`) as intentional bounded future-extensibility scaffold (T10.2 of plan `arch-review-fixes-2026-06-06`; FO#4 of 2026-06-06 architecture audit). Rationale + ADR cross-references (D170-D177) + 12-month re-evaluation trigger documented. No code change.

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0

## [Unreleased]

### Added — Tier 1 Expansion variants (T0.1, ADRs D389/D397/D405/D413)

- `SMSMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-sms`.
- `MattermostMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-mattermost`.
- `LineMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-line`.
- `MatrixMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-matrix`.
- `PlatformName` union opened to include `"sms" | "mattermost" | "line" | "matrix"` (10 platforms total).

### Changed

- Backward-compatible additive change — existing adapters / consumers continue to compile. The single `exhaustive switch` test was updated to cover the new 4 cases (EC-5 absorbed).

## [0.4.0] - 2026-05-24

### Added

- `EmailMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D339). Required for `@theokit/gateway-email`.
- `PlatformName` union opened to include `"email"`.

### Changed

- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.3.0] - 2026-05-23

### Added

- `TeamsMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D325). Required for `@theokit/gateway-teams`.
- `PlatformName` union opened to include `"teams"`.

### Changed

- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.2.0] - 2026-05-23

### Added

- `WhatsAppMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D308). Required for `@theokit/gateway-whatsapp`.
- `PlatformName` union opened to include `"whatsapp"`.

### Changed

- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.1.0] — 2026-05-20

### Added

- Initial release. Core gateway primitives for `@theokit/sdk`.
- `BasePlatformAdapter` abstract class — contract for transport adapters (ADR D172).
- `MessageEvent` discriminated union with `platform` discriminator (ADR D173).
- `GatewayRunner` — top-level orchestrator with drain timeout on `stop()` (EC-E).
- `SessionRouter` — pure routing strategy; composes `Agent.resume` (ADR D174).
- `DeliveryRouter` — outbound dispatch; composes `Cron` (ADR D175).
- `HookExecutor` with `pre_inbound` / `post_outbound` / `on_error` (ADRs D176, D177).
- `ctx.reply` auto-routes to the adapter matching `event.platform` (EC-G).
- `{ block: true, message }` from `pre_inbound` triggers auto-reply before short-circuit (EC-D).
- All runner error log paths wrap text in `Security.redact(...)` from `@theokit/sdk` (EC-F, ADR D68).
