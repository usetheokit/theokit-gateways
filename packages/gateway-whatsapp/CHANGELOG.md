# Changelog

## 0.3.3

### Patch Changes

- 467af35: The unofficial (Web) bridge now exits on SIGTERM instead of hanging with Chromium still running.

  Measured 2026-08-30: sending SIGTERM to the bridge did not stop it at all — the `exit` event never
  fired and ten Chromium processes stayed up. puppeteer registers its own SIGTERM/SIGINT/SIGHUP
  handlers by default, and registering any handler replaces Node's terminate-on-signal default; the
  bridge installed none of its own, so it inherited a shutdown that waits on a browser close which
  never arrives while WhatsApp Web is still loading.

  Anything that supervises a process stops it with SIGTERM — systemd, Docker, pm2, a parent Node
  process. Every such stop left a bridge that would not die and a leaked browser tree, recoverable
  only with SIGKILL, which cannot close anything cleanly. Restarting therefore accumulated Chromium
  processes and session directories.

  The bridge now owns its termination signals and closes the browser under a five-second deadline,
  then exits regardless. Re-measured on the same probe: the process exits in ~6s with code 0 and zero
  Chromium processes survive.

## 0.3.2

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

## 0.3.1

### Patch Changes

- Drop the unused `@theokit/sdk` peer dependency, so a TheoKit app can install an adapter.

  Every adapter declared `peer @theokit/sdk@^2.18.0` and imported the SDK in **zero** source files.
  The framework ships `@theokit/sdk@4.x`, so `npm install @theokit/gateway-line` into a TheoKit app
  failed outright with `ERESOLVE`.

  The core's range was widened in `@theokit/gateway@0.7.0`, which was not enough on its own: an
  adapter's own manifest still carried the pin, so installing one still failed even against the fixed
  core. Measured in a real app before and after.

## 0.3.0

### Minor Changes

- e0330fe: **The `WhatsAppBackend` contract now says what it requires, and all three implementations are held to it at once.**

  The interface declared bare signatures with no prose, so each backend answered the unasked questions its own way — and they diverged. `send()` on a disconnected backend refused in web (`"Bridge not connected."`) and in Baileys (`"Baileys backend is not connected."`), and **posted anyway** in Cloud. A consumer swapping backends, which is the single thing this seam exists to allow, would have found their unconnected sends leaving the process: for Cloud, a real request carrying a credential nothing had verified, or one `connect()` had already rejected.

  Three changes, in the order that matters:

  - **The contract is written down.** `connect()` is idempotent and returns `false` rather than throwing; `disconnect()` is idempotent and safe on a backend that never connected; `send()` requires a successful `connect()` and refuses without one, without touching the transport.
  - **`not_connected` is its own error code.** Two backends called this state `server_error` and one had no opinion. A caller branches on the code, and a conformance test can only assert on one — so three descriptions of one state is the divergence, not a detail. **This widens the error union**, so an exhaustive `switch` stops compiling until the case is handled.
  - **A conformance suite runs the contract against every implementation.** A per-backend test proves one implementation does something; only a shared one proves they do the _same_ thing, and the substitutability is the product. A fourth backend inherits it by being added to the table, which is where someone decides whether it complies rather than discovering later that it does not.

  Verified by mutation: making any one of the three diverge fails the suite.

- b1e5dd3: **Meta's `131030` gets its own error code: `recipient_not_allowlisted`.** It used to collapse into the generic `invalid_request`, which sends a developer to re-read a payload that was correct. The remedy is a console step — register the recipient against the phone number — and it travels with the message now, exactly as `session_window_expired` already does for `131047`.

  This is the error most Cloud API integrations meet first. Every app starts on a free test number whose recipients must be registered one at a time, so it is both the commonest failure and the one where a wrong diagnosis costs the most: the request is fine, so nothing in it explains the refusal.

  **This widens `WhatsAppSendResult["error"]["code"]`**, so an exhaustive `switch` over it stops compiling until the new case is handled. No call site in this repository switches on it.

  The WhatsApp live suite now distinguishes the two, and does so without giving itself a hiding place. An unregistered recipient is incomplete configuration — the same category as a missing credential, which this suite already skips whole platforms for — so it skips, naming the number and the console step. But a recipient _we_ mangled would be refused identically, so the skip is only reached after asserting that the recipient which actually left the process, captured through the `fetch` seam, is the one configured.

  That guard took two attempts. The first compared `digitsOnly(configured)` against `configured` — which reads as a check on our own bytes and is not one, because `digitsOnly` is not on the send path at all. It asserted that the env var contains digits, and was satisfied unconditionally. A reviewer substituted the adapter's own `botPhoneId` for the recipient — a one-token regression, one line away in the same class — and watched a total outbound-routing failure skip as a provisioning gap. The current guard fails that mutation, which was verified by performing it.

### Patch Changes

- 038fa86: **`WhatsAppCloudBackend.connect()` now asks Meta before reporting success.** It was `return true`, unconditionally — no request, no validation, no error path. A consumer with a wrong, expired or revoked token got success at startup and found out from messages that silently never arrived: no error, no log, nothing to alert on, which is the worst way for a message gateway to fail.

  It verifies against the phone number itself rather than `/me`, and that choice is the point: a token can be perfectly valid and still have no access to _this_ phone number id, which is the likelier of the two misconfigurations. Checking only the token would wave it through.

  The reason survives. `connect()` still returns a boolean — every sibling adapter is tested against "returns false rather than **throwing**", because a throw at startup takes the whole runner down — but it writes the mapped cause to stderr first. Told only `false`, a supervisor cannot tell a revoked token, which needs a human, from a rate limit, which needs a wait.

  Verification happens once and is cached, like every sibling: re-asking on each call would turn a health check into a rate-limit source against Meta.

  **How it was found is worth more than the fix.** 209 unit tests in this package passed throughout, and none of them could have caught it — the fake backend always accepts, so `return true` is indistinguishable from a successful check. It surfaced on the _first ever_ execution of `integration/tests/whatsapp/live.test.ts`, a file whose own header read `NEVER EXECUTED`, minutes after real Cloud API credentials existed for the first time. Measured across the ten adapters: the seven with live coverage all authenticate inside `connect()` and all pass the equivalent assertion. WhatsApp Cloud was the only one that did not.

  A cross-adapter gate now fails when any `connect()` body invokes nothing at all. It is deliberately weak — it cannot tell a real check from a pointless one, only that the function does work before claiming the work succeeded — and that is precisely the shape that was missing.

  `WhatsAppError` is now a named export, extracted from the inline type inside `WhatsAppSendResult` rather than duplicated beside it: a credential check and a send fail for the same reasons, and two declarations of one vocabulary drift the moment somebody adds a code to one of them. `WhatsAppCredentialCheck` is new. Neither changes an existing shape.

- 5d40a95: **`connect()` now checks that the credential resolves to the configured phone number, not merely that the request succeeded.** The first version read only the HTTP status, which meant three ways to report a working credential that does not work:

  - a `200` carrying an error envelope, which Meta does send;
  - an empty or unreadable `200`, which a captive portal or proxy sends;
  - a `200` describing a **different node** — and this is the live one. Pasting a WhatsApp Business Account id where the phone number id belongs is the commonest Cloud API misconfiguration, and `GET /{waba_id}` with a management-scoped token answers `200`. The check said yes; every send then failed.

  That last case is exactly what the method's own docblock claimed to catch — _"a token can be valid and still have no access to this phone number id"_ — while the code checked access and not identity. The response names the node it reached, so the fix is to compare it, and the refusal now says which node it got and which it expected.

  Also fixed: a `disconnect()` arriving while a verification was in flight left `connected` set to `true` when that verification resolved, so every later `connect()` short-circuited on a flag no live check stood behind — despite the field's own comment promising `disconnect()` cleared it. A generation counter retires the abandoned attempt, the same guard the Baileys backend carries.

- 878c0ee: Five findings from an independent review of the credential-check and conformance work, all closed:

  - **`verifyCredentials()` threw on a `null` body.** `response.json()` resolves `null` for the JSON literal, which is neither `undefined` nor an object, so the guard let it through and the next line dereferenced it — and the throw escaped `connect()` unwrapped. That is precisely the clause this series exists to defend: a throw at startup takes the host down with it. Arrays, strings and numbers were equally unguarded and now are.
  - **`sendTemplate()` still posted an unverified credential.** The guard went on `send()` and stopped there. Being off the `WhatsAppBackend` interface — WhatsApp Web has no templates — is why the conformance suite structurally cannot see this method, which is a reason it needs its own guard, not a reason to be exempt from the rule.
  - **The conformance suite asserted three of the five clauses it was written to enforce.** `connect()` idempotency and its failure contract were unasserted, which is exactly why the `null`-body throw above was invisible to the suite added to catch that class. Both are covered now — and writing them exposed that the contract itself was wrong: it demanded `false` absolutely, and two backends "failed" by throwing on a missing browser and a missing peer. They were right. **Misconfiguration throws; operational failure returns `false`**, and the interface says so.
  - **The `web` conformance row observed nothing.** It carried `reachedNetwork: undefined` and a comment naming the elapsed-time check as its coverage — which a reviewer disproved by mutation, in about a millisecond. It uses the backend's documented `spawnFactory` seam now, so the row counts spawns like the others, and stops writing `.wwebjs_auth` into the package as a side effect.
  - **A numeric `id` produced a refusal that contradicted itself**: _"resolves to node 12345, not the configured phoneNumberId 12345"_. Compared as strings.

## 0.2.0

### Minor Changes

- 389bd0d: **`WhatsAppAdapter.fromCloud()` and `.fromWeb()` now exist.** The class docblock has instructed consumers to call them since the package was written, and neither did. Three exported types described that API — `WhatsAppAdapterOptions`, `WhatsAppCloudConfig`, `WhatsAppWebConfig` — and no source file consumed any of them. Anyone following the only construction guidance the package gave wrote code that did not compile.

  The factories build the backend and delegate to the constructor, so a consumer stops importing `WhatsAppCloudBackend` to pass it in. The constructor stays for tests and for a backend of your own.

  They also validate — `accessToken`, `phoneNumberId`, `sessionId`, and `apiVersion` when it is supplied. Deliberately **not** `appSecret`: it verifies inbound webhook signatures and outbound never reads it, so requiring it would lock an outbound-only consumer out of the path the factory exists to offer. This repository's own integration suite passes `""` for exactly that reason. `fromCloud` with an empty `accessToken` now throws `ConfigurationError` at construction rather than returning an adapter that fails later against the network — a factory that hands back something which cannot authenticate has moved the error away from its cause, so the stack names a send when the mistake was in construction. `ConfigurationError` extends the core's `GatewayConfigurationError` and carries this package's prefix, so one `catch (e) { if (e instanceof GatewayConfigurationError) }` works across the adapters that use it. Counted rather than assumed: four of the nine siblings do — line, matrix, mattermost and sms. The other five (discord, email, slack, teams, telegram) do not reference the base at all, so this is a convergence toward a shared base and not yet a property of the whole family.

  `WhatsAppAdapter.from(options)` is the entry point for configuration that arrives as **data** — read from a file, an environment or a tenant record — where the backend is a string rather than a decision made in code. It is what `WhatsAppAdapterOptions` exists for, and until it had that consumer the union was exported, documented and inert, which is the defect #47 was filed about.

  `WhatsAppAdapterOptions` was reshaped: the union now carries only what differs between backends. `requireMention`, `botPhoneId` and `allowedSenders` mean the same thing on either one and moved to `WhatsAppAdapterCommonOptions`, so there is one copy rather than one per arm for the two to drift apart. Nothing consumed the type before, so no caller can break.

  Worth naming why the alternative was rejected: deleting the promise and documenting the real constructor was cheaper and equally honest, and it was the front-runner until a third backend became concrete. With three, picking one by a string discriminator is the ergonomics the union was written for.

  `quality:doc-coverage` read 100% throughout, because it measures whether a docblock exists and not whether it is true.

  **A misconfiguration that used to be silent now says so.** `requireMention` defaults on and `botPhoneId` has nothing to default from on the web backend, so a web adapter built without one dropped every group message and explained nothing — the adapter cannot tell whether it was mentioned. The drop is now logged, matching the sibling allowlist check fifteen lines below it, whose own comment says a silent drop is indistinguishable from a broken gateway.

  **Known cost, measured.** `fromWeb` holds a static reference to `WhatsAppWebBackend`, so a bundler can no longer drop the web backend from a cloud-only consumer's build: an esbuild bundle of `import { WhatsAppAdapter }` alone grows from 6,565 to 33,780 bytes. No new runtime dependency is pulled — `whatsapp-web.js` is still only `import()`ed inside the spawned bridge, never at import time. Accepted rather than fixed: this package targets Node, where that size is not a user-facing cost, and the alternative is an async factory, which is a worse API for every consumer in order to serve bundle size for some.

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

- fe1f25c: **The `web` backend never started, and when it failed it said nothing useful.** Three defects, each hiding the next.

  **It died before reaching a browser.** The bridge read `Client` and `LocalAuth` off the module namespace of `whatsapp-web.js`. That package ends its `module.exports` object with a spread, and `cjs-module-lexer` — which Node uses to synthesise named exports for a CommonJS module — cannot statically analyse an object built that way. It proved `Client` and gave up: measured on 1.34.7, `mod.LocalAuth` is `undefined` while `mod.default.LocalAuth` is a function. The API now comes off the default export, with a namespace fallback for a true-ESM module.

  **It could not be found at all from the published package.** `defaultBridgeScriptPath()` walked `../../bridge/` from the module — correct in the source tree, where `src/backend/web/` up two is `src/`. The bundle is one flat file at `dist/index.js`, so the same walk landed on `packages/bridge/`, one directory above the package. The child died with `MODULE_NOT_FOUND`. Both layouts are now checked, and neither existing raises a named error instead of returning a path that cannot work.

  **And every one of those failures surfaced as a timeout.** `connect()` raced only the `ready` promise; a bridge that reported exactly what was wrong had its message written to stderr and dropped. The caller paid the full `connectTimeoutMs` — two minutes by default — and received `WhatsAppConnectTimeoutError`, the one error carrying no cause. A reported failure now rejects `connect()` immediately with `WhatsAppBridgeError`, which is new and exported, and carries a machine-readable `code`: `peer_missing`, `peer_incompatible`, `peer_load_failed` or `bridge_script_missing`. The `IpcEvent` error arm carries that code too.

  A package that is present but does not export what the bridge needs is now distinguished from one that is absent — telling a consumer to run `pnpm add` for a package they already have sends them the wrong way. `ERR_MODULE_NOT_FOUND` separates them.

  **What this does not fix.** No browser is installed here, because `puppeteer` is absent from `pnpm.onlyBuiltDependencies`. That failure is now reported rather than crashed on, with Chrome's own install command in the message, but the backend still cannot reach WhatsApp. Tracked separately.

  Minor rather than patch: `WhatsAppBridgeError` and `defaultBridgeScriptPath` join the public API, and `IpcEvent`'s error arm gains an optional `code`.

  Nothing had ever executed any of this. Every test injected a fake child process, and the live suite excludes the web backend by declaration, so 132 green tests sat over a backend that could not start, could not be found, and could not say so. Seven tests now drive the real script and the real spawn — and each was checked by reverting the fix it covers and confirming it goes red.

- c1d40db: **The Cloud API error mapper now recognises the codes Meta actually sends.** It recognised none of them.

  `cloudErrorCode` tested `errCode === 130 || errCode === 131`. No Cloud API response can satisfy that — the codes in those families are six digits (`130429`, `131047`, `131026`, `130403`). Someone truncated the prefixes, the rate-limit branch became dead code, and every real throttle reached the caller as `invalid_request`. A consumer with backoff behind `code === "rate_limit"` never saw it fire, and kept calling an API that was throttling it.

  The unit test that claimed to cover this passed a fabricated code `130` and asserted `rate_limit` — which it got from the HTTP 429 in the same call, not from the code. It proved the mapper agreed with whoever wrote the test. Every code in the suite is now one Meta publishes, with the number stated in the test.

  **Two new codes, because collapsing them threw away the answer.**

  `session_window_expired` (`131047`) — more than 24 hours since the recipient last replied. The credential is valid and the payload is correct; WhatsApp policy refuses free-form text outside that window, and Meta's own remedy is to resend as an approved template. Reported as `invalid_request`, that instruction was indistinguishable from "your JSON is wrong". The message now carries the remedy too.

  `undeliverable` (`131026`, `130403`) — the recipient has no WhatsApp account, has not accepted the terms, is on an outdated client, or has been blocked by the business. Terminal: no retry changes it, which is the opposite of what `invalid_request` suggests.

  Rate limiting now covers `4` (app), `80007` (business account) and `130429` (Cloud API throughput), alongside the HTTP 429 that was doing all the work.

  Minor rather than patch: `WhatsAppSendResult["error"]["code"]` gains two members, so an exhaustive `switch` over it stops compiling until the new cases are handled. That is the intended prompt — the two conditions were always reachable, and were being silently mislabelled.

- c157088: **A fail-closed sender allowlist.** The package had no sender filter at all. `shouldDropGroupMessage` fires only for _groups_ with `requireMention`, so any stranger who sent a direct message reached the handler — and from there whatever agent is behind it.

  That is two problems wearing one coat. A number that answers strangers accumulates blocks and reports, which is what WhatsApp's enforcement runs on, so an open gateway is a slow route to a banned number. And an agent wired to tools acts on what arrives, so an unfiltered inbound is an instruction channel for anyone who knows the number.

  Pass `allowedSenders` to the adapter — a comma-separated list — and anything not on it is dropped and logged. `"*"` opens it, and has to be written deliberately.

  **Absent and empty are different answers, on purpose.** No `allowedSenders` at all means the filter has not been adopted and delivery is unchanged; turning it on by default would mute every existing deployment, which is a breaking change and belongs to its own decision. An empty `allowedSenders` means someone configured a list and named nobody, and that is honoured: nobody gets through. The inverse default is a mistake worth naming — it makes the safest-looking configuration, the empty one, the most open.

  An unidentifiable sender is refused even under the wildcard: `*` means "any sender", and something whose sender cannot be named is not a sender.

  Identifier matching handles the shapes WhatsApp and humans actually produce — `5511999999999@s.whatsapp.net`, a `:12` device suffix, `+55 (11) 99999-9999`, and group JIDs. The device suffix is stripped before digits are taken; folding it in yields `551199999999912`, which matches nothing, so an allowlist would silently stop recognising a sender the moment they paired a second device.

  Refusals are logged. A silent drop is indistinguishable from a broken gateway, and a mistyped allowlist otherwise presents as a bot that went mute for no reason.

- 90d3720: **`WhatsAppCloudBackend.sendTemplate()` — the send that reaches someone who has not written first.**

  The adapter could only send `type: "text"`, and Meta refuses free-form text more than 24 hours after the recipient last replied. That excluded every notification use case, and it made the integration impossible to check unattended: the live suite's outbound test asserted success while its own comment admitted it would fail on policy, so a red run meant "the recipient has not written recently" as often as it meant "something is broken".

  Templates carry no such condition. `hello_world` is pre-approved on every WhatsApp Business account, so validating outbound now needs nothing arranged by hand.

  It is deliberately **not** on the `WhatsAppBackend` interface. WhatsApp Web has no concept of templates, and widening the shared contract would hand the web backend a method it could only throw from. Reach it by holding `WhatsAppCloudBackend` directly.

  `components` is omitted from the payload when absent rather than sent empty, because Meta rejects `components: []` on a template that declares no variables. The POST-and-interpret half of `sendText` moved into a shared `postMessage` rather than being copied.

  The live outbound test now checks the template send, and the free-form text test asserts the pair it can honestly assert: either the message went out, or Meta refused it for the one documented policy reason and the mapper reported `session_window_expired`. An auth failure, a malformed payload or an unrecognised code still fail, and are now distinguishable from a recipient who simply has not written lately.

### Patch Changes

- e682180: **A message whose handler throws no longer kills the bot.** On Teams and on WhatsApp's web backend it did — not degraded delivery, an exit code. `Error: ... / Node.js v22.22.2`, and the next message never arrived.

  Both dispatched with `void handler(event)`. `void` reads as "I am not waiting for this"; what it tells the runtime is "I am not handling the error", and under Node 22's default an unhandled rejection ends the process. Measured against both adapters through their own injection seams before the fix, and again after: the throw is now contained, named, and delivery continues.

  **Discord and Telegram contained it but blamed the wrong thing.** The rejection escaped into the platform library's error channel, so a bug in the consumer's own handler surfaced as `[discord] client error` / `[telegram] bot error`. Anyone debugging that went looking in discord.js and grammy for a fault that was in their own code. Both now report `handler threw` and return `"handler_threw"` from the internal dispatch seam.

  **WhatsApp Cloud dropped the rest of the batch, and made the platform resend it.** Meta packs several messages and their delivery receipts into one webhook, and the dispatch loop awaited each handler with nothing around it. One throw skipped every remaining message in the payload, skipped the status receipts, and rejected `handleWebhookPayload` — so the caller's route answered 500 and Meta redelivered the whole batch, replaying the messages that had already been handled. That is a duplicate-reply bug reached through a different door than the one fixed in #11. The same method also now answers `false` on a signed body that is not JSON, instead of throwing out of a method whose contract is `true`/`false`.

  **Email gained a net it did not strictly need.** Its drain is written never to reject, and it does not — but both launch sites discard the promise, so that property was the only thing between a future edit and the same fatal rejection, and nothing enforced it. The catch now lives at the site that would pay for it.

  **The contract is written down, and held to.** `BasePlatformAdapter.onInbound` now states it: a handler may throw, and an adapter must contain that throw, report it as the handler's failure rather than the platform's, and keep delivering. Eight of ten adapters had converged on exactly that with nothing recording it. `tests/lint/adapter-contract.test.ts` gains two invariants — every adapter names a handler throw as the handler's, and no adapter launches a user callback with a bare `void` — and both were checked against a deliberately reverted adapter to confirm they fire rather than pass vacuously.

- 272e111: **`WhatsAppCloudBackend` and `WhatsAppWebBackend` now identity-guard their unsubscribes.** Both are public exports implementing the exported `WhatsAppBackend` interface, so a consumer holding a backend directly — rather than going through `WhatsAppAdapter` — hit `onInbound(A)` → `onInbound(B)` → `A.off()` and stopped receiving anything, with no error and no crash. The Baileys backend had the guard; its two siblings never did.

  The reason the gap survived is worth more than the fix: the cross-adapter contract test checked this invariant **per package**, so one compliant file covered every other file beside it. It now checks per declaration.

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

- 9e7384e: **A stale unsubscribe no longer deafens the adapter.** The function `onInbound` returned called whichever backend handle was _current_ rather than the one it owned, so `onInbound(A)` → `onInbound(B)` → `A.off()` tore down **B's** subscription and nulled the handler. The adapter then received nothing, with no error and no crash — the worst way for a message bus to fail, because there is nothing in a log to see and nothing to alert on. It is now identity-guarded, and so is `onStatusReceipt`.

  Worth naming: this is precisely the defect the cross-adapter contract test exists to catch, and this adapter was exempted from it by a comment asserting its mechanism was "a different mechanism with the same guarantee". It had no guard at all. The exemption is removed — the one adapter the gate excused turned out to be the one carrying the defect, which is what an exemption written from a reading of the code rather than a test of it eventually becomes.

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

- Initial package skeleton (Roadmap v1.4 #2).
- `WhatsAppAdapter` extending `BasePlatformAdapter` with multi-backend support (ADRs D303-D314).
- `WhatsAppCloudBackend` for Meta WhatsApp Business Cloud API (D304).
- `WhatsAppWebBackend` for `whatsapp-web.js` subprocess bridge (D305).
- `verifyWebhookSignature` + `verifyWebhookSubscription` helpers (D306, D312).
- `splitForWhatsApp` 4096-char message splitter (D310).
- `mapWhatsAppCloudError` + `mapWhatsAppWebError` per-backend error mappers.
- Group mention filter with digit-only normalizer (D309).
- Status receipts via `onStatusReceipt` callback (D307).
