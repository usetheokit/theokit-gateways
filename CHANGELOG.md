# Changelog

Changes to the repository itself — tooling, workflows and repository-wide sweeps.
Changes to a published package are recorded in that package's own changelog under
`packages/`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **gateways:** B-013 registered — `pnpm audit` reports 43 transitive advisories (1 critical, 19 high) across the published packages, found while auditing dependencies for another plan and deliberately not folded into it

- **gateways:** five measured items on the theokit ↔ theokit-sdk ↔ theokit-gateways integration (B-008..B-012): the event union cannot be extended out-of-repo, no adapter can translate the raw payload TheoKit's channel seam hands it, ten adapters name the same credential seven ways, nothing documents which repo owns which half of the seam, and the SDK's entire role is one redaction helper

### Fixed
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
