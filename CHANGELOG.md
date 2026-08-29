# Changelog

Changes to the repository itself — tooling, workflows and repository-wide sweeps.
Changes to a published package are recorded in that package's own changelog under
`packages/`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **repo:** `@types/node` moves from `^26.4.0` to `^22.12.0`, matching the `engines.node: >=22.12.0` every package declares. Typechecking against the types of a Node line we never claimed to support measured the wrong thing, and it had `quality:dts-typechecks` red for at least six commits: `@types/node@26` renamed `util.InspectOptionsStylized` to `InspectContext`, and `@sapphire/shapeshift@4.0.0` — reached through `discord.js` → `@discordjs/builders` — still imports the old name. The gate now asks the question a consumer on our declared floor asks. It does NOT make the upstream break go away for a consumer who installs `@types/node@latest` alongside `discord.js` and runs type-aware lint; that is filed separately, because we cannot fix it here
- **gateway-mattermost, gateway-line, gateway-sms:** four peer ranges refused the very version their own tests load, so a consumer installing an adapter beside a current SDK got `ERESOLVE` (#79). Every range is now measured rather than inherited: `@mattermost/client` becomes `^9.0.0 || ^11.0.0`, and **v10 is deliberately excluded** — `connect()` fails there with `window is not defined`, because `lib/websocket.js` calls `window.addEventListener('online'/'offline')` unconditionally and the adapter constructs a `WebSocketClient` during connect. v9 never had those calls and v11 removed them; both pass all seven live tests against a real server. `express` becomes `^4.18.0 || ^5.0.0` on line and sms, and `twilio` becomes `^5.0.0 || ^6.0.0` on sms, each end verified by pinning it and running the package's suite. Each adapter now dev-depends on the SDK it is tested against, so which version a run exercises is declared instead of decided by pnpm's peer resolution
- **gateway:** a malformed entry in the `hooks` list is now refused at construction instead of skipped in silence (#80). Every fire point asks `if (h.<phase> === undefined) continue`, which reads "this hook does not implement this phase" and "this is not a hook" identically — so a config-driven list with an entry that failed to resolve started a gateway whose rate limiter, audit trail or error reporter was simply absent, and said nothing. A silently missing security hook is worse than a loud failure: the deployment looks correct. `HookExecutor` now raises a `GatewayConfigurationError` with code `malformed_hook` naming the index and the reason — not an object, no name, declares none of the three phases, or declares one that is not callable. A hook implementing only one phase is still accepted, which is the ordinary case

### Added
- **repo:** the README's Packages table gains a third column saying what has actually been exercised against each real platform, and a section defining what "full" means — connect, refuse a bad credential without throwing, deliver, split at that platform's own cap, map a refusal, refuse empty text, and receive a message back. Six adapters are full (Telegram, Discord, Slack, Matrix, Mattermost, Email); LINE sends but its inbound test has never run; WhatsApp's send is accepted by Meta rather than confirmed delivered; Teams and SMS have no credentials and are reported as never executed rather than as passing. Measured 2026-08-29 — 52 live tests passed, 9 skipped — with the reproduce command beside the claim. The readiness suite, which CI runs without credentials, now fails when a registered platform is missing from that table or carries an empty status; it deliberately cannot check whether a status is still true, and says so

- **gateway-discord:** ships `shims/types-node-26.d.ts`, an opt-in one-line fix for the `@types/node@26` incompatibility, and a README section naming it so a consumer does not debug it inside a package they never installed (#81). Measured in a scratch consumer: with `@types/node@26` the project fails to compile (TypeScript's own `skipLibCheck` default is `false`) and passes with the shim included; with `@types/node@22` it passes either way, the declaration merging with the interface already there. It is loaded by nothing — a library that augments Node's own types for every consumer changes the type environment of people who never asked. `@types/node@26` renamed `util.InspectOptionsStylized` to `InspectContext`; `@sapphire/shapeshift@4`, which `discord.js` pulls through `@discordjs/builders`, still imports the old name, and `@sapphire/shapeshift@5` imports the new one and therefore breaks on `@types/node@22`. `@discordjs/builders@1.14.1` declares `^4.0.0`, so no `discord.js` release reaches v5 and no combination satisfies both type lines. The note gives the workaround and says what closes it

- **tools:** `pnpm quality:peer-range` fails when a package's declared peer range refuses the version that package actually loads. The two drifted in silence for two majors on `gateway-mattermost` (#79) and the suite went green against a real server the whole time, because nothing compared them. Reads `package.json` only, no network. It resolves from each package's own `node_modules` rather than the integration suite's — pnpm resolves a peer per consumer, and the first version of this gate read the wrong one and reported an offender that did not exist. It refuses a range shape it cannot parse instead of reporting success, which is how a gate stays worth its green

- **docs:** the README now says which repository owns which half of the channel seam — TheoKit the route and the signature check, these packages the translation, the SDK one redaction helper — with a worked example whose symbols are verified by the existing doc-api gate. A new `quality:integration-story` check fails if that disappears, and passes when the prose is rewritten around the same facts (#B-011)
- **all adapters:** all 15 credential-bearing fields across the ten packages now document the platform's own term for them and where they are issued, on the published option types — so an editor answers "which field?" on hover instead of the developer opening the type. That includes the ones beyond each adapter's primary token: Slack's `appToken`, LINE's `channelSecret`, Vonage's `apiSecret` and `signatureSecret`, WhatsApp's `appSecret`. Where our name diverges from the platform's SDK (`botToken`, mattermost's `accessToken`, `password`) the docblock says so. A cross-adapter gate derives the package list from disk and fails when any field omits it (#B-010)
- **gateway-telegram, gateway-sms:** `parseInbound` — an app can translate a raw webhook body into a canonical event without re-declaring the platform's wire format. The two signatures differ because the platforms do: Telegram is `parseInbound(payload)` over a JSON body TheoKit's channel seam already parsed, while SMS is `parseInbound(options, ctx)` because its signature check needs the raw body, the headers and the URL — none of which the channel seam hands over — so SMS is wired through its own `createWebhookServer`, not through `handleChannelWebhook`. Measured before: an app wiring Telegram wrote 35 lines, 27 of them platform knowledge. Every field the translator copies is narrowed at the boundary, so a payload with `text: 5` yields an event whose `text` is `""` rather than the number 5, and one with `date: NaN` is rejected outright rather than producing `receivedAt: NaN`. `gateway-line` and `gateway-whatsapp` already shipped this shape and are unchanged (#B-009)
- **tools:** `pnpm quality:registry-augmentation` compiles twelve hostile registry augmentations, each in its own program against the published declaration, and fails when one of them breaks a first-party consumer instead of being excluded. Two such shapes were found in review and neither was reachable from any test here, because a `declare module` poisons the whole compilation rather than being observed (#B-008)
- **gateway:** `PlatformEventRegistry` — a gateway can now be authored, published and consumed outside this repository. `PlatformName` and `MessageEvent` derive from an interface other packages extend by declaration merging, so exhaustive narrowing still holds, including over platforms the core has never heard of. Both sides of an augmentation are gated: an entry typed `any`, registered under an index signature, carrying a non-literal discriminator, or disagreeing with its own key is excluded rather than admitted — each of those was measured to break narrowing for every consumer before the guard existed. `BaseMessageEvent.platform` widens to `string` as a consequence; every variant still narrows it to its literal. See `docs/adr/0002-platform-event-registry.md` (#B-008)
- **gateways:** B-013 registered — `pnpm audit` reports 43 transitive advisories (1 critical, 19 high) across the published packages, found while auditing dependencies for another plan and deliberately not folded into it

- **gateways:** five measured items on the theokit ↔ theokit-sdk ↔ theokit-gateways integration (B-008..B-012): the event union cannot be extended out-of-repo, no adapter can translate the raw payload TheoKit's channel seam hands it, ten adapters name the same credential seven ways, nothing documents which repo owns which half of the seam, and the SDK's entire role is one redaction helper

### Changed
- **gateway-whatsapp, gateway-teams:** three send/connect tests confirmed the RESULT and never the REQUEST. A short message asserted one send happened, not that the message reached the number it was addressed to — an adapter sending "" to somebody else counted the same; a template send read `wamid` out of the fake's reply, which comes back the same whatever recipient the request carried, so the failure that matters there (a template delivered to the wrong person) was invisible; and Teams' `connect()` proved it asks Microsoft without proving it asks about THIS app, so passing the appId where the clientId belongs would have verified a credential nobody configured and reported the gateway ready. The Teams fixture now uses distinct placeholder ids in the two uuid slots, because with the same value in both a swapped argument matches by luck
- **gateway:** the runner's hook contexts are asserted, not assumed. A `pre_inbound` hook is handed the event it is deciding about and an `on_error` hook is handed the event and the error — that is the whole hook API — and nothing checked either, so both could have arrived empty while the suite stayed green: every hook in the suite ignored its argument and returned the same verdict regardless. Also closed: a blocking hook whose message is EMPTY (what a template that rendered to nothing produces) must not attempt a reply, the same guard's other half; a delivery that reached no transport must report `ok: false`, not merely carry an error; and the drain set must shrink back to empty, since a settled dispatch that is never removed leaks one promise per message for the life of a process that is meant to stay up. Score 93.35% -> 95.09%, and every one of the 20 survivors left is now accounted for in `packages/gateway/tests/MUTATION.md` as equivalent — a mutation no test can kill because it computes the same thing. Two of them are notes for whoever changes the code next rather than the tests: a malformed hook is silently ignored instead of refused, and one `inflight.add` is redundant
- **gateway:** the credential masker reached 98% on the mutation audit, from 79%, and what closed the gap was one placement: every fixture put the secret at the END of the string, where a trailing lookahead has nothing to look ahead at and passes vacuously — so six of the seven patterns' closing anchors were unobservable and could have been inverted. A following character makes them mean something. Also pinned: an Entra secret with the SHORT prefix, which is what the optional character in that pattern admits (with only the wide form present, dropping it masked one width and leaked the other), and the covered half of the catalogue now has the documentation gate the uncovered half always had — every shape must name its package and say what else it would eat, a note that was emptiable without a test noticing. The two survivors left are equivalent: `String(s)` is `s`. In the runner, four paths gained the assertion that separates them from doing nothing: a second `start()` must not open a second session per adapter, a blocking hook with no message must not ATTEMPT a reply (the mock now counts attempts, since `sent` only records what it accepted), the `no_adapter` failure must name the platform, and `commandPrefixes` — an option that exists to accept more than one — is now exercised with two. Score 87.44% -> 93.35%, `break` follows to 93
- **gateway:** the mutation audit now covers the runner every inbound event passes through and the credential masker that keeps secrets out of logs, not just the two chunkers and the hook chain. Extending it was the point: the two new files arrived with 65 survivors and three mutants NO test reached at all — `start()`'s rollback, the path that closes the adapters it already opened when another refuses, so a failed start could have leaked a live platform connection with nothing noticing. That path now has a test, and three gaps in the masker are closed: nothing checked that a masked secret is replaced by `***` rather than deleted, no pattern's leading anchor was ever exercised from the side where it must REFUSE a match, and `redactSecrets` was documented to take "anything stringifiable" while every call handed it a string. Measuring the anchors surfaced a real property, now written down: an anchor can only refuse what the leading segment's width cannot absorb, which for Discord is four characters — it errs toward masking a superset, so the cost is over-redaction, never a leak. `thresholds.break` is 87 over the new four-file scope; the config says in full why that is not a drop from the 94.35% recorded over two
- **gateway-mattermost:** the constructor's two fields assert the `code` that names which one was missing, instead of only the shared error type; the redundant "carries actionable code" case is folded into them
- **gateway, gateway-email, gateway-sms, gateway-matrix, gateway-line:** the same two defects the mutation audit found on the core paths were swept across the other packages, and both were present. Four stderr/console spies were installed and never read — including the one over `console.warn` in the email adapter, which meant the three sender filters (loopback, automated, allowlist) were only asserting that nothing was delivered, a result a parse failure or a dead drain produces just as well; the warn line naming the filter is what separates them. And fifteen negative cases asserted the error TYPE where several fields share one: matrix and line now assert the `code` per field (an adapter reporting `channel_secret_required` for a missing access token used to pass), SMS asserts the message that names the backend because all three backends share one code, and `normalizeE164` distinguishes empty from malformed. Two redundant cases were folded into the ones that subsume them; no other test count changed
- **gateway:** the tests over the two mutation-audited critical paths (`text/chunk.ts`, `hooks/executor.ts`) now assert what they were only exercising. Mutation score 76.27% -> 94.35%, with the test count up by one: a validation test asserts the error MESSAGE rather than only the type, so a caller can tell `limit` from `safeLimit`; a stderr spy that was installed and never read is now read; the hook chain gains a hook that runs, allows and lets the chain continue — the ordinary case no test covered; the surrogate guard is pinned as a no-op above the surrogate range, where fullwidth CJK lives; and the shared corpus gains boundary shapes (a vanishing tail, a boundary exactly on the half-window, a remainder of exactly the window) that separate the comparisons from their off-by-one neighbours. The 10 mutants that remain are equivalent by construction and are enumerated in `packages/gateway/stryker.config.json`, so nobody re-derives them. `thresholds.break` rises 75 -> 93, keeping the ratchet one mutant below the measured floor

- **all packages:** dependencies updated to current — `@theokit/sdk` 4.62.0, biome 2.5.11, vitest 4.1.11,
  `@types/node` 26, express 5, twilio 6, nodemailer 9. TypeScript is pinned at 5.9.3 rather than raised:
  6.x needs a deprecation flag for a `baseUrl` that `tsup@8.5.1` injects — its latest release, so there is
  nothing to upgrade to — and defeats `tools/repair-dts-imports.mjs`, while 7.x removes the compiler API
  that gate is built on. The pin is exact so a later `pnpm update` cannot walk into it silently.

### Fixed
- **gateway:** the emoji-splitting test could not see the bug it was named for. It used one
  character, U+1F600, whose low surrogate sits mid-range — so the boundary comparisons in
  `guardSurrogate` could be changed either way and it still passed. It now exercises the two
  characters whose low surrogates ARE the bounds, checks both ends of every chunk, and asserts the
  rejoined text equals the input. Mutation score on the critical paths: 76.27% -> 80.23%.
- **integration:** the LINE inbound suite proved nothing and its skip named a remedy that did not
  work. The test body was `expect(true).toBe(true)`, and `describeLiveInbound` skipped every webhook
  platform unconditionally while telling the reader to set `INTEGRATION_PUBLIC_URL` — which nothing
  read. The harness now honours that variable, and the test asks LINE to dial our endpoint itself
  (`POST /v2/bot/channel/webhook/test`), then verifies the signature over the raw bytes.
- **gateway-line, gateway-sms:** the webhook server could not be restarted. `started` and `stopped`
  were latched and never reset, so a `start()` after a `stop()` returned without creating a listener
  and the server was silently dead — no error, no log, just a port nothing answers on. Found by
  looking at the one assertion in each suite that could not fail.
- **gateway-teams:** `connect()` reported success without checking the credential. The SDK's
  `initialize()` validates nothing — measured with a client id of all zeros and an invented secret,
  it returned `true` in 474ms — so the adapter claimed a connection it had never established. It now
  asks Entra for a bot token first, and returns `false` carrying Microsoft's own error code. Every
  sibling adapter already did this; Teams was the one left, hidden because its live suite has never
  had credentials to run.
- **integration:** readiness reported a provisioned platform as `[ready]` while its server was down.
  For Matrix and Mattermost the credentials are written BY the bootstrap script, so finding them in
  `.env` proves the container was once up and never that it is up now — measured when a live run spent
  two minutes failing 16 tests to discover two stopped containers. The report now carries a third state,
  `[down]`, naming the variable and the command that fixes it.
- **integration:** a live send that fails now names its own reason. Fourteen assertions across nine
  platforms read only `SendResult.ok`, so a failure reported `expected false to be true` and discarded
  the `error: { code, message }` the adapter had filled in — measured when an intermittent SMTP failure
  cost a hand-written probe to recover a reason the result already held.
- **gateway:** the credential-documentation gate had stopped running — `9729ab3` replaced the body of the test that called it instead of adding one beside it, so every adapter's `@platform-term` / `@issued-at` docblock went unchecked behind a green suite. Restored, and verified to fail when a docblock is removed.
- **tools:** the published-value gate resolved TypeScript by directory path, which skips the package's `exports` map and depends on the package manager hoisting it to the root. Both assumptions broke at once; it now resolves by name, and `tools` declares the dependency it compiles with.
- **gateway-email:** the `nodemailer` peer was `^8.0.0`, and the whole of `^8` sits inside the range an advisory names vulnerable — so a consumer following it got a vulnerable nodemailer and one who wanted a safe one got a peer conflict. Now `^9.0.1`; nodemailer 9 keeps the four functions this adapter uses and its 95 tests pass against it (#B-013)
- **repo:** `pnpm audit`'s findings describe the tree a contributor installs, not what a consumer receives. Measured against the registry: installing all eleven published packages yields 2 high — both the nodemailer one above — and no critical. The critical (`form-data <2.5.4`) arrives through `plivo`, an OPTIONAL peer nobody gets without choosing Plivo, and is now pinned by an override: after regenerating the lockfile, `request@2.88.2` resolves `form-data` to 4.0.6, nothing resolves below 2.5.4, and the audit drops from 43 findings to 41 with no critical. `docs/security/dependency-advisories.md` records the measurement and how to check what a consumer actually receives (#B-013)
- **all published packages:** the declarations cited 76 decision ids and 59 of them resolved nowhere. They were never deleted — they were written in implementation plans under `.claude/`, which is development tooling and is not versioned, so the citations reached npm inside a `.d.ts` while the documents defining them stayed on one machine. `docs/adr/decision-ids.md` now lists every cited id with its status: 17 **recorded** with the decision recovered, 59 **lost**. The lost ones are recorded as lost rather than deleted, because a reader who meets `D412` in a docblock is better served by "not recoverable" than by silence, and deleting the citations would destroy the only evidence the decisions were made. `pnpm quality:adr-citations` fails when a new unaccounted citation enters a published declaration (#B-015)
- **tools:** `quality:docs` could leave probe files in a package root. The doc-api gate writes them to typecheck what the documentation claims and removed them on two of its paths, so an exception between the two — or a Ctrl-C — left them behind, untracked and unignored. Two agents hit that during a review and one cleaned it by hand. The per-root work is now wrapped in `finally`, and `.doc-probes/` is gitignored, which is what covers the case no handler can: a SIGKILL runs nothing (#B-016)
- **gateway-telegram:** a unit test called the real Telegram API. `EC-I: connect() with bad token resolves to false` produced its failure by sending a bogus token to `api.telegram.org` and waiting for the 401, so the suite failed when the network was slow and passed when a proxy answered — found while running the gates for a type-level change in a different package. It now rejects `init()` directly: the same contract, in 15 ms instead of a round trip, and it also covers the failures a bad token never reaches — DNS failure, 5xx, socket reset. The full suite ran green 10 consecutive times (#B-014)
- **gateway:** the SDK's redactor left this repository's credentials in the log. Measured across the sixteen credential fields the ten adapters declare: one was masked — Slack's `xoxb-`, an SDK built-in. On a Telegram token it was worse than absent, because a token is `<bot_id>:<secret>` and the SDK's `key=value` rule stops at the colon: `token=8123456789:AAF…` came out `token=***:AAF…`, the PUBLIC bot id removed and the secret half kept. Six shapes with a distinctive structure are now masked entirely — not the SDK's `first6…last4`, since six leading characters of a token identify the account — before the text reaches the SDK at all. Ten fields are recorded as deliberately uncovered with the reason: 32 lowercase hex is also an md5 and a dashless UUID, 26 lowercase alphanumerics is a ULID, and a passphrase is indistinguishable from prose — masking those would eat the correlation ids a developer reads a log to find. A field-level gate fails when an adapter declares a credential that is neither masked nor recorded (#B-012)
- **gateway-telegram, gateway-sms, docs:** the published docblocks and the READMEs said a TheoKit app's `onMessage` runs *after* the 200 is answered, so a throw there had no status left to change. Measured against `theokit@0.48.14`: `handleChannelWebhook` awaits `onMessage` **before** the response is built and catches nothing around it, so a throw means the 200 is never built, and mounted in a TheoKit route the rejection reaches that route's error boundary and is answered 500 where the platform expected an acknowledgement. `parseInbound` returning `null` is unchanged and still the right contract — only the reason given for it was wrong. It had spread through the repository, reaching the `.d.ts` both adapters publish. No count is given here on purpose: four successive sweeps each reported a different one, and the fourth still missed a site (#B-011)
- **docs:** the READMEs implied every adapter exports `parseInbound`. Only `@theokit/gateway-telegram` and `@theokit/gateway-sms` do; the others export their translation under their own names, each with its own signature, so the README now says to read the one you are using (#B-011)
- **tools:** `quality:integration-story` checked its three facts across the whole file, so both documented sections could be deleted — even replaced with sentences denying the relationship — while it reported PASS. Facts now count only inside the section meant to carry them, in visible prose: HTML comments and fenced code (``` or `~~~`, indented up to three spaces, closer at least as long as its opener) are blanked first, and link targets — inline, reference definitions and bare autolinks — no longer count as naming anything. A forgotten closing fence runs to end of file, because for a reader it turns the rest of the document into code; an unterminated comment does not, because `<!--` appears in ordinary prose and treating it that way reported documented sections as missing. The gate states in its own PASS line that it checks presence and never accuracy (#B-011)
- **gateway:** `MessageEvent`'s docblock pointed at `wiki/decisions/adr-0001-…`, a path removed in `b1b3e09` and never restored — a published `.d.ts` sending readers to a file that does not exist. ADR-0001 is restored at `docs/adr/0001-message-event-closed-union.md` and the citation repointed (#B-007)

- A behavioural conformance suite runs the `PlatformAdapter` contract against all nine
  credential-based adapters at once, needing no credential and no network. The existing
  cross-adapter gate reads source text — the right tool for what it catches, and the wrong one for
  this, since getting it honest took five attempts of which four passed while checking nothing.
  All nine conform, verified by mutation. One invariant is deliberately absent and says so: it was
  written, it passed, and mutation showed it could not fail without a dispatch seam the nine do
  not have

- A second review round closed five more: `verifyCredentials()` threw on a `null` JSON body, which
  broke the very "returns false rather than throwing" clause the work exists to defend;
  `sendTemplate()` still posted an unverified credential because it sits off the shared interface
  and the conformance suite cannot see it; that suite asserted three of five contract clauses, and
  writing the missing two revealed the contract itself was wrong — misconfiguration should throw,
  operational failure should return `false`, and two backends had been right all along; the `web`
  conformance row observed nothing and now uses the documented spawn seam; and a numeric node id
  produced a refusal that contradicted its own text

- The `WhatsAppBackend` contract states what it requires, and a conformance suite holds all three
  implementations to it together. The interface declared bare signatures, so each backend answered
  the unasked questions its own way and they diverged: `send()` on a disconnected backend refused
  in web and Baileys and posted anyway in Cloud — a real request carrying a credential nothing had
  verified. `not_connected` is now one error code across all three, because a caller branches on
  the code and a shared test can only assert on one. Verified by mutation: making any single
  implementation diverge fails the suite

- The WhatsApp credential check verifies identity, not just access. Reading only the HTTP status
  let three shapes report a working credential that does not work: a `200` carrying an error
  envelope, an empty `200` from a proxy, and — the live one — a `200` describing a different node,
  which is what pasting a WhatsApp Business Account id where the phone number id belongs produces.
  That last case is precisely what the check's own docblock claimed to catch while the code did
  not. A `disconnect()` racing an in-flight verification also left `connected` set behind it; a
  generation counter retires the abandoned attempt

- Meta's `131030` has its own WhatsApp error code, `recipient_not_allowlisted`, instead of
  collapsing into the generic `invalid_request` and sending a developer to re-read a payload that
  was correct. The remedy is a console step — register the recipient against the phone number —
  and it travels with the message, as `session_window_expired` already does for `131047`. It is
  the error most Cloud API integrations meet first, because every app starts on a free test number
  whose recipients are registered one at a time. Widens the error union, so an exhaustive `switch`
  stops compiling until the case is handled

  The live suite now separates configuration from defect: an unregistered recipient skips, naming
  the number and the step, rather than reporting a provisioning gap as a red build forever. The
  skip is not a hiding place — a recipient the code itself mangled would be refused identically,
  so it is only reached after proving the configured number survives normalisation unchanged

- The integration bootstrap scripts name reused container state as the cause instead of leaving
  the reader to guess. Both create a server and then create accounts inside it, so both are
  idempotent only against a fresh container; against one that outlived the last run they failed in
  two voices that named neither cause. Matrix's was actively misleading — `Invalid registration
  token`, for a token read from the log and sent correctly, "invalid" only because the server
  consumed it at first boot, which sends the reader hunting the one thing that is not wrong. Each
  failure now prints the remedy, and only when the failure matches a reused-state signature: the
  advice on every failure would send someone to recreate a container over a network blip and train
  them to skip the line

- `WhatsAppCloudBackend.connect()` asks Meta before reporting success. It was `return true`,
  unconditionally, so a wrong, expired or revoked token passed the startup check and surfaced as
  messages that silently never arrived. It verifies against the phone number rather than `/me` —
  a token can be valid and still have no access to *this* number, which is the likelier
  misconfiguration — caches the result, and writes the mapped reason to stderr before returning
  false, because `auth_failed` and `rate_limit` ask a supervisor for opposite responses (#58)

  Found on the **first ever** run of `integration/tests/whatsapp/live.test.ts`, a file whose own
  header read `NEVER EXECUTED`, minutes after real Cloud API credentials existed. The package's
  209 unit tests passed throughout and none could have caught it: the fake backend always
  accepts, so an unconditional `true` is indistinguishable from a successful check. Of the seven
  adapters with live coverage, all seven authenticate inside `connect()`; this was the only one
  that did not. A cross-adapter gate now fails any `connect()` body that invokes nothing

- A stale unsubscribe no longer deafens the WhatsApp adapter. The closure `onInbound` returned
  called whichever backend handle was *current*, so `onInbound(A)` → `onInbound(B)` → `A.off()`
  tore down **B's** subscription and nulled the handler: the gateway went silent with no error
  and no crash. It is now identity-guarded like every sibling, and so is `onStatusReceipt`.
  This is the exact defect the cross-adapter contract exists to catch, and WhatsApp was exempt
  from it — by a comment asserting its mechanism gave "the same guarantee", when that mechanism
  had no guard at all. The exemption is gone; the one adapter the gate excused was the one
  carrying the defect. The Cloud and web backends carried it too, and are fixed alongside: both
  are public exports of the exported `WhatsAppBackend` interface, so a consumer holding one
  directly reached the defect without going through the adapter.

- The unsubscribe invariant is now checked per DECLARATION, not per package. Checked per package,
  one compliant sibling covered the rest — which is how three WhatsApp backends came to have one
  guard between them. Getting there took three attempts, and the first two could not fail: one
  regex matched zero declarations (every one types its parameter as a function, so `[^)]*` stops
  at the inner signature), and the next read a fixed window that reached into the neighbouring
  method and accepted ITS guard. The check now brace-matches the method body and requires the
  guard to name the same field that body stores the handler in, and it asserts the exact count
  of declarations it found — a gate that silently checks nothing is worse than no gate. A fifth
  round then found the brace matcher could still be fooled by an unbalanced `{` inside a string
  literal, and that the count assertion, written as a floor, caught a declaration disappearing
  but not one being added. Both closed; reverting the guard in any of nine sites across six
  files now fails it

- The cross-adapter contract gate stopped accepting a comment as a guard. Two of its invariants
  read source with comments intact, so commenting a guard out passed while deleting it failed —
  it detected removal, not disablement, the same shape the file's own history records finding
  once before. Both were also satisfiable without doing anything: `if (this.handler === handler)
  {}` passed the unsubscribe check, and the connect check accepted `if (this.<any field>` with no
  return at all. Measured across all ten adapters, every one guards on `this.connected` and
  returns, so the gate now requires that — and requires the unsubscribe to actually clear

- A webhook dispatch that rejects no longer ends the process in `gateway-line` and `gateway-sms`.
  Both answer the provider before running the handler — deliberately, since both retry a webhook
  they did not see a 200 for — which leaves the dispatch floated, and a floated rejection is an
  unhandled one. Same defect fixed across the other adapters in #41; these two were missed because
  the cross-adapter gate only recognised the shape `void this.…` and both float through a local.
  The gate now matches any floated call, which is how they surfaced

- The `tools` suite no longer fails when the whole monorepo runs at once. Several of its tests
  drive the TypeScript compiler in-process, and the one-time lib-loading cost exceeds vitest's 5s
  default under twelve competing package suites — so the gate reported machine load as a code
  failure. The timeout now states what the work costs

### Added

- A third WhatsApp backend, on Baileys — the multi-device protocol over a WebSocket, with no
  browser (B-001). Added rather than replacing the `whatsapp-web.js` one, so nobody loses a paired
  session, the comparison between them becomes measurable instead of asserted, and retreat stays
  cheap. `baileys` is an optional peer dependency loaded lazily at connect; 36 tests drive an
  injected fake socket and pass with it absent — nine of them written after a review found four
  defects reachable in normal operation: a timed-out send that stayed on the socket while the next
  one started, a failed connect that left a live socket delivering inbound, a `disconnect()` during
  connect that wedged the backend until it was rebuilt, and a QR code with nowhere to go, which
  made pairing a fresh session impossible — then nine more after a second, independent review
  round found four more: a retired connect attempt that could only be ended by its own timeout,
  so `disconnect()` during pairing blocked shutdown for 60s with the socket still live; a socket
  closed by the server that was never ended and became unreachable to any later `disconnect()`;
  a second sequential `connect()` that opened another live session unguarded by any test; and a
  failed connect that reported a bare `false`, leaving an unlinked device indistinguishable from
  a network blip. `createBaileysSocket` — 201 lines, the one place this touches the real library,
  and the module whose header cites the bridge that shipped unable to start — had no tests at
  all; it has ten. Each fix has a test that fails when that fix alone is reverted. What none of them prove is that any of it speaks
  WhatsApp: pairing needs a QR scan by a human, so protocol conformance, delivery and ban behaviour
  are unproven here and by every gate in this repository

- `WhatsAppAdapter.fromCloud()` and `.fromWeb()`. The class docblock had instructed consumers to
  call them since the package was written and neither existed, so the only construction guidance
  the package gave produced code that did not compile (#47). Three exported types described that
  API with no consumer in any source file. The factories validate at construction — an empty
  `accessToken` now throws `ConfigurationError` rather than returning an adapter that fails later
  against the network — and `WhatsAppAdapterOptions` was reshaped so the union carries only what
  differs between backends, and `WhatsAppAdapter.from(options)` gives that union its first
  consumer — the entry point for configuration that arrives as data rather than as a decision in
  code. A review caught that the first attempt left the union inert and the file docblock still
  naming a mechanism that did not exist, which was #47 relocated rather than closed.
  `quality:doc-coverage` read 100% throughout, because it measures whether a docblock exists and
  not whether it is true

- `BACKLOG.md` — the maintenance registry this repository governs itself with, plus the routing
  table and domain specialist that make an item resolvable. The routing table shipped as the `theo`
  ecosystem's eight domains, none of which name anything here, so every item filed would have been
  refused as unroutable; it is now derived from this project. `integration` and `tools` were added
  by hand — `pnpm-workspace.yaml` declares them but the detector globs `packages/*` and does not
  reach them. First item: **packages/gateway-whatsapp:** backlog B-001 — measure what the
  whatsapp-web.js backend costs, and give it a rival

- A fail-closed sender allowlist for WhatsApp (`allowedSenders`). The package had no sender filter:
  `shouldDropGroupMessage` fires only for groups with `requireMention`, so any stranger's direct
  message reached the handler, and from there whatever agent is behind it. Absent and empty are
  deliberately different — no allowlist leaves delivery unchanged, an empty one admits nobody — so
  adopting the filter never mutes an existing deployment by surprise. Refusals are logged, because a
  silent drop is indistinguishable from a broken gateway (#47 records a separate documentation
  defect found on the way)

- WhatsApp can now be validated without arranging anything by hand. Its live suite had never been
  executed, and could not have answered whether the integration worked: the adapter could only send
  free-form text, which Meta refuses more than 24 hours after the recipient last replied, so the
  outbound test asserted success while its own comment admitted the send might be refused on policy.
  `WhatsAppCloudBackend.sendTemplate()` carries no such condition, and `hello_world` is pre-approved
  on every WhatsApp Business account. The text test now asserts the pair it can honestly assert —
  delivered, or refused for that one documented reason and reported as `session_window_expired`
  (#46)

- The live suite now proves the core's capabilities instead of one of them. It drove exactly one of
  `@theokit/gateway`'s ten runtime exports — `GatewayRunner` — and nothing anywhere said so; the
  six defects fixed in this same cycle all sat in code no live test touched, two of them fatal to
  the process. `tests/gateway-e2e.test.ts` gains seven round trips against a real homeserver: a
  handler that throws and a next message still answered, `on_error` receiving that failure,
  `post_outbound` receiving the platform's real acknowledgement, `runner.command()` slash dispatch,
  `stop()` draining a handler still running when it is called, a stopped runner refusing to restart,
  and `DeliveryRouter` on the outbound-only path no other test reaches. Each was checked by breaking
  the capability and confirming the test goes red — the `post_outbound` and slash-dispatch tests
  were run against a deliberately mutated core (#38, #39, #41)

- A capability-parity gate in `integration/tests/readiness.test.ts`: every runtime export of
  `@theokit/gateway` must be named by a live test or listed with a written reason, and an exemption
  naming an export that no longer exists fails too. It is the sibling of the platform/suite parity
  check already in that file, pointed at the core. Today's four exemptions are all one reason —
  `chunkText`, `chunkByGrapheme`, `defaultStrategy` and `SessionRouter` are pure functions, so a
  live run would prove nothing a unit test does not

- Three cross-adapter invariants in `packages/gateway/tests/lint/adapter-contract.test.ts`, which
  reads all ten adapters and fails when one stops matching its nine siblings: every adapter names a
  throwing handler as the handler's failure, none launches a user callback with a bare `void`, and
  the empty-text check precedes the transport-state check. Each was run against a deliberately
  reverted adapter to confirm it fires rather than passes vacuously — a check that earned its keep
  immediately, since the first version of the third invariant passed against the reverted adapter
  by matching its own explanatory comment instead of the code. All three strip comments before
  asking (#41, #42)

- `Workflow Lint`, a CI gate running actionlint and zizmor over `.github/workflows/`, so the
  pipeline's own conventions are checked by a machine rather than by whoever reads the diff (#33)
- The integration package's offline logic now runs on every pull request, not nightly. The modules
  deciding whether a webhook delivery may write to `.env`, which binary the capture script executes
  and how a value reaches `.env` are covered by 43 tests behind `test:unit` — a script name
  `pnpm -r run test` cannot reach, so the invariant that keeps live tests off pull requests is
  untouched (#35)

### Changed
- **gateways:** every package declared a peer on `@theokit/sdk@^2.18.0`, which no adapter imports and which the framework left behind at 4.x — a fresh TheoKit app could not install a gateway at all. The core's peer is widened to `>=2.18.0 <5` (verified green against 4.53.1) and the unused peer dropped from the ten adapters (#B-007)

- `/code-quality` now audits something. `code-quality-languages.txt` shipped empty, and an empty
  file means no language is checked — so the gate returned `PASS` with `languages_audited: []`, a
  green that verified nothing. TypeScript is enabled against the root manifest, and the gate now
  reports D1–D4 clean across the workspace and D5 skipped with its reason (no dependency-cruiser
  config), which is the honest shape of a partial audit

- Two peer gateways were cloned into the read-only study zone to inform the WhatsApp work:
  `openclaw/openclaw` (Apache-2.0) and `NousResearch/hermes-agent`. What was learned is recorded as
  a finding with citations, not as code — both remain third-party material and nothing was copied
  from either. The one thing that changed our code came from measuring our own: the Cloud API error
  mapper matched none of Meta's real codes (#46)

- The live integration suite no longer receives the npm publish credential. `Release` called it
  with `secrets: inherit`, which passes every secret the caller holds; the 42 platform secrets are
  now declared and passed one by one (#33)
- Every package publishes with a signed provenance attestation, via npm trusted publishing instead
  of a long-lived token. A consumer can verify that a tarball was built by this repository at this
  commit (#33)
- Node pinned to 22.12.0 and pnpm to 10.34.1, resolved from `.nvmrc` and `packageManager` (#33)

### Fixed

- The WhatsApp `web` backend now starts. Its bridge took `LocalAuth` off the module namespace
  of `whatsapp-web.js`, which exports that name only on the default, so it is `undefined` and the
  process dies 1011 ms in with `TypeError: LocalAuth is not a constructor`. Nothing caught it
  because nothing ever executed the script: every test injects a fake child process, and the live
  suite excludes the backend by declaration — 132 green tests over a backend that cannot start. A
  second, independent blocker sits behind it: `puppeteer` is absent from
  `pnpm.onlyBuiltDependencies`, so no browser is ever downloaded. Fixed (B-002), and the fix
  uncovered two more defects behind it: the bridge could not be **found** from the published
  package — the path walk was written for the source tree and landed one directory above the
  package in the flat bundle — and every failure surfaced as a 120-second timeout, because
  `connect()` raced only the ready promise and wrote the bridge's own diagnosis to stderr before
  dropping it. All three are closed, each with a test that goes red when that fix alone is
  reverted. The browser gap remains and is now reported with Chrome's install command rather than
  crashed on

- A hardening sweep over the runner and all ten adapters closed six defects, each measured against
  the running code before it was filed and re-measured after the fix. Two were fatal to the process:
  a message whose handler threw ended the bot on Teams and on WhatsApp's web backend. The others
  were a runner that could not be stopped after a restart, a `stop()` that held the process open for
  its whole drain window, a documented public hook point with no caller, and one adapter answering a
  different error code than the other nine. Per-package detail is in the changesets; what belongs
  here is that the sweep happened and what it now costs to regress — see the invariants added above
  (#37, #38, #39, #41, #42)

- The DTS repair no longer leaves scratch files inside a published package. It asks the compiler
  where a type comes from by writing a one-line `.dts-probe-*.ts` into the package, compiling it,
  and deleting it — but the delete sat after the compile step rather than in a `finally`, and the
  compile step could end the run outright via `process.exit`, which does not unwind the stack. A
  probe from a process that no longer existed was found untracked in `packages/gateway-whatsapp/`,
  one `git add -A` away from being committed to a public repository. The compile step now throws
  and a single handler turns it into the same exit code, so every cleanup on the way out runs; a
  hard kill leaves nothing behind that the next run does not sweep first; and `.gitignore` matches
  the pattern, so a leftover cannot be committed even then (#40)

- The live suite can no longer pass a release gate while testing nothing. A skipped suite is as
  green as a passing one, and `Integration (live)` gates publication, so a secret that was deleted,
  renamed or emptied would silently turn its platform off. `INTEGRATION_REQUIRE_PLATFORMS` now
  names the platforms a run must exercise, and readiness FAILS when one of them is unconfigured.
  An expired credential was never the risk — the positive `connect()` test fails loudly; this
  covers the credential that stops being present (#32)

### Security

- The `e2e` environment, which holds every platform credential, is restricted to the `develop` and
  `main` branches. It had no protection rule and no branch policy at all, so any workflow on any
  branch could read all 16 secrets — the environment was giving the grouping of a vault with the
  access control of a plain repository secret (#36)
- `pnpm capture:line` verifies LINE's HMAC signature before parsing a delivery, and rejects an
  unsigned one with 401. It served a public tunnel URL, answered 200 to everything and took
  `source.userId` from whatever arrived, while `LINE_CHANNEL_SECRET` sat unused in the same `.env`;
  a third party who found the URL could have written a forged id to disk (#35)
- `pnpm capture:line` no longer downloads `cloudflared`. It fetched the binary from
  `releases/latest`, made it executable and ran it with the exit code of `curl` as the only check —
  on the machine holding all ten platforms' credentials, in a repository that pins its actions by
  commit SHA. It now requires one installed by a package manager, which verified its signature.
  This also retires the hard-coded `linux-amd64` asset and a cached binary nothing revalidated (#35)
- Telegram inbound's MTProto session is no longer wired into CI. The decision to leave that suite
  uncovered was documented in three places and enforced by none: the workflow declared
  `TELEGRAM_TEST_SESSION` and piped it into both steps, so the only barrier was nobody having
  filled the secret in. An MTProto session is full access to a Telegram account, not a scoped
  token (#36)
- A `workflow_dispatch` input reached the shell as text spliced into a command line, in the step
  holding every platform credential. It is now passed as an environment variable (#33)
- Every GitHub Action is pinned to a commit SHA rather than a movable tag, so the code that runs
  with this repository's secrets cannot change without a commit here (#33)

### Changed

- **Test runs no longer claim every core on the host.** None of the 12 package configs capped `maxWorkers`, so vitest's default applied — `os.availableParallelism()`, one fork per core, each booting a full test environment. This repo's `test` script fans out across packages, so that default is paid once per package *concurrently*: measured on a 12-thread machine, pnpm runs 6 packages at a time, which is 72 CPU-bound forks on 12 cores. The cap now leaves 4 cores free (`Math.max(2, cpus().length - 4)`), which scales with the runner instead of hard-coding one machine's core count. It costs no wall-clock — measured in `theokit-ui`, the full suite ran 73.96s at 4 workers against 74.36s at 12, so the parallelism above the cap was already noise. (usetheokit/theokit-ui#51)

- The four actions in the release workflow are pinned by commit SHA instead of by ref. The job
  publishes as this organization, so a moving ref decides what runs in it. `changesets/action@v1`
  was the sharpest edge: `v1` is not a tag in that repository but a **branch** — the tag lookup
  returns 404 — so any push to it changed the code running with those credentials, with no release
  and no version bump to notice. Each pin carries the version it resolved to, read from the
  action's own tags. Majors are unchanged: this freezes what already runs rather than upgrading it.
