# ADR-0003: The Teams activity verifier calls the SDK validator by its `dist` path

- Status: Accepted
- Date: 2026-10-06
- Deciders: gateway cluster maintainers
- Evidence: the `gateway-teams-inbound-verifier` plan and its alignment brief, measured 2026-10-06
- Superseded in part by [ADR-0005](0005-the-teams-verifier-owns-key-retrieval.md): the verifier now reads
  the key sets and checks the signature before the SDK, so the consequences below on the key-set
  outage, the unknown-key budget and the tenant-issued key budget no longer hold

## Context and Problem Statement

An app that receives Microsoft Teams activities on its own HTTP route has to tell a request
Microsoft signed from a forged one before it delivers anything. `@theokit/gateway-teams` exported
no way to do that.

The check exists, inside `@microsoft/teams.apps`, and only there. The SDK's HTTP server validates
the Bot Framework token through a class its package root does not export:
`ServiceTokenValidator` in 2.0.x (read in the installed 2.0.15) and `InboundActivityTokenValidator` in 2.1.x
(read in the published 2.1.0 tarball, unpacked outside this repository on 2026-10-06; only
2.0.15 is installed here). Both live at `@microsoft/teams.apps/dist/middleware/index.js`, a path the SDK
does not publish as an entry point. Both take `(appId, tenantId?, serviceUrl?, logger?, cloud?)`
and expose `check(authHeader, body)`, which resolves a token or throws.

That validator alone does not refuse every forged request:

- on the Bot Framework path it restricts no tenant, whatever `tenantId` it was given;
- the 2.1.0 Entra path accepts a token for whichever tenant it names and compares no `serviceurl`;
- both versions skip the `serviceurl` comparison when the body carries no `serviceUrl`.

`adapter.ts` already refuses `dist/token-manager` as an unpublished path. Departing from that
convention here needs a record that travels with the code.

## Decision

**`teamsActivityVerifier` loads `@microsoft/teams.apps/dist/middleware/index.js` with one lazy
`import()`, takes `InboundActivityTokenValidator` when exported and `ServiceTokenValidator`
otherwise, constructs it once per verifier, and calls `check(authHeader, activity)`. After the SDK
accepts, it checks three claims of the same token in a fixed order: `aud`, then `serviceurl`, then
the tenant (`tid`, or a tenant-issued `iss` when no tenant is configured).**

Every failure to load is a refusal, `validator_unavailable`, never a throw. Either class is safe to
prefer only because the claim checks run after it on both.

## Consequences

- The package binds to an unpublished SDK path under the peer range `^2.0.0`. A release that moves
  the module or renames both classes makes every request refuse as `validator_unavailable`; the
  test that loads the installed SDK with no seam fails on that bump before it ships.
- **`tenant_unverified` on the Bot Framework path.** A verifier configured with `tenantId` refuses
  every Bot Framework activity whose token carries no `tid`, and Microsoft documents none on
  connector tokens. The README says to omit `tenantId` on that path.
- **Agentic-identity (Entra) activities are refused as `serviceurl_mismatch` on 2.1.x**, because the
  platform signs no `serviceurl` on them.
- A key-set outage reads as `invalid_token`, the same as a forgery. The key client and its timeout
  belong to the SDK (`jwks-rsa`); a key set that never answers holds the request for that timeout,
  so the route should bound the call with its own.
- **Unknown signing keys are budgeted, and a published key is never starved.** The SDK's key
  client (`jwks-rsa` 3.x, built with `rateLimit: false`) caches only keys it found, and
  `jsonwebtoken` asks it for the key before any signature, algorithm or expiry check. So each token
  naming a `kid` the cache lacks was one request to Microsoft's key endpoint, for a value an
  unauthenticated sender chose: 20 forged tokens with fresh kids made 20 key-set requests (finding
  #60, measured 2026-10-06). The verifier reads the `kid` from the unverified header and:
  - refuses a token with no `kid` (or one that is not a three-segment JWT) as `invalid_token`
    before the SDK, because the key client fetches the key set to resolve a missing `kid` too;
  - lets at most 10 tokens per fixed 60-second window reach the SDK when their `kid` is one no
    accepted token used; a `kid` is learned only when the SDK accepted its token, and a learned
    `kid` is never limited;
  - past those 10, lets a token reach the SDK only when the published Bot Framework key set lists
    its `kid`. The verifier reads that set itself (the `kid` values only; the SDK still checks
    every signature), from the URL both SDK versions derive (the cloud's `openIdMetadataUrl` with
    `/openidconfiguration` replaced by `/keys`), when a `kid` is missing from the copy it holds, at
    most once per 10 seconds, with a 10-second timeout, keeping the last copy when a read fails.

  The first version (commit 4559794) had only the budget, and a `kid` was learned only from an
  accepted token, so at a cold start or after a key rotation every genuine token competed with
  forged ones for the same 10 slots: a sender spending them each minute kept genuine activities
  refused for as long as it kept sending (review of 2026-10-06, F-xval-10). Now the worst case is
  that a key Microsoft publishes is refused for up to 10 seconds after it appears, if a forged
  token caused a read just before it did. Outbound cost: at most 10 requests a minute through the
  SDK plus one read every 10 seconds.

  Two limits remain. A `kid` the published set lists reaches the SDK, whose key client caches 5
  keys; if Microsoft publishes more than 5, a sender cycling through listed kids can still cause
  key-set requests through the SDK. And the budget is per verifier, not per client; a per-client
  rate limit in front of the route remains the operator's.
- **A tenant-issued token for a tenant the verifier refuses never reaches the SDK.** On 2.1.x the
  SDK checks a token whose unverified `iss` is an Entra issuer against the key set of the tenant its
  unverified `tid` names, one key-set client per tenant, so a fresh `tid` per request would cost one
  key-set request each (review finding F-dom-t-4, read in the 2.1.0 tarball, not executed). Such a
  token is refused before the SDK with the tenant reason the claim checks would give it (it could
  never be accepted: an accepted token's verified claims are the same claims), and a tenant-issued
  token's `kid` is budgeted apart from Bot Framework ones. Past the budget a tenant-issued token is
  refused, because the published-key read covers the Bot Framework set only.
- The verifier hands the SDK validator a silent logger. Without one, the SDK's default
  `ConsoleLogger` writes an error line for every token it refuses, with claim values the sender
  chose, so a flood of forged requests would become log volume an unauthenticated sender writes.
  The cost is that the SDK's own diagnostics are gone; the refusal reason is what remains.
- The control test in `packages/gateway-teams/tests/` deep-imports `ServiceTokenValidator`; a
  lockfile bump to an SDK without that name fails it at load, which fails closed.

## Amended 2026-10-07: the activity must come from Teams

A verified token binds a request to the bot and, through `serviceurl`, to a connector endpoint; it
does not bind it to a channel. The bot's Web Chat and Direct Line channels (enabled by default on
an Azure Bot resource) receive connector tokens with the same audience and a `serviceurl` equal to
their activity's `serviceUrl`, and on those channels the client sets `from` and `channelData`,
which `normalizeTeamsActivity` turns into the sender, tenant and team (code review #94). So the
fixed order is now `aud`, `serviceurl`, the activity's `channelId`, then the tenant: a `channelId`
that is absent or not `msteams` is `channel_mismatch`, checked in `checkVerifiedClaims` so the
mutation run covers it. It runs after the SDK, like the claim checks, so a forged token on another
channel is still `invalid_token`.

Not adopted: filtering published keys by their `endorsements`, the Bot Framework's channel binding
for keys. The `channelId` check already refuses every non-Teams activity, and `endorsements` is not
read by the SDK validator either. The Azure portal's "Test in Web Chat" (`webchat`) and the Bot
Framework Emulator (`emulator`) are refused by design; no option re-admits them, because the
adapter would read client-chosen identity fields as Teams ones. Emulator tokens were already
refused before this change: they are Entra-issued (`sts.windows.net` or the login endpoint) and
carry no `serviceurl` claim, so they get a tenant reason or `serviceurl_mismatch`. Inferred from the
issuers the Bot Framework documents for the Emulator; not run against an Emulator.

## Amended 2026-10-09: a body the route already read is the route's fault

The plan's tie-break D5 (b) said a body the verifier cannot read is `malformed_body`. Commit
4db76b8 then answered a request whose body was already read, or locked by another reader, with
`validator_unavailable`, so a route bug no longer read as a sender's malformed body. The review of
2026-10-08 found that answer false and harmful (findings F-arch-3 and F-xval-2): the validator had
loaded and was never reached, so a consumer switching on the reason was told the wrong thing, and
the README answers `validator_unavailable` with a 503, which has the Bot Framework retry a fault no
retry can clear for as long as the route stands.

**Decision.** Such a request has its own reason, `body_already_read`, in
`TeamsActivityVerifyResult` (commit 9e74992). Its message says the body was already read or is
locked and to pass the verifier an unread request. The README route answers it with a 500 and logs
that message. Two neighbouring cases keep the sender's reason: a body stream that fails part-way
through the read, and a POST with no body at all (`request.body` is `null`), are both
`malformed_body`.

**Alternatives considered.**

- `validator_unavailable`, the 4db76b8 answer. Rejected for the two reasons above: the name
  describes a different fault, and its 503 starts a retry loop.
- `malformed_body`, the plan's D5 (b). Rejected: the sender's bytes were never examined, so a 400
  blames the sender for the route's bug, and the Bot Framework does not retry a 4xx, so the
  activity is lost while the operator looks for a bad client.
- A `TypeError` thrown for a programming fault, as `rules/error-handling.md` allows for a misuse.
  Rejected: FR-003 promises a refusal for every request and never a throw, and a throw on the
  webhook path becomes the framework's own 500 with no reason a route can log or count.

**Consequences.** The reason union grows to eleven members. A route that switches exhaustively over
`reason` needs the new case; none is published yet (`@theokit/gateway-teams` 0.2.1 has no
verifier). `the-readme-route-answers-each-verdict-with-its-status.test.ts` runs the README route and
pins the 500.

## Amended 2026-10-09: the verifier's code is split by job

`activity-verifier.ts` had grown to 766 lines against the plan's 500-line budget and held six jobs
(finding F-arch-2). Commit 43ec118 split it with no behaviour change: the SDK load, the silent
logger and the `check()` call moved to `sdk-validator.ts`; the public types and refusal messages to
`verifier-contract.ts`; `activity-verifier.ts` keeps the factory, the body read, the admission to
the SDK and the orchestration. The decision of this ADR, the lazy `import()` of the `dist` path
under either class name, now lives in `sdk-validator.ts`. The key-set and signature modules are
recorded in [ADR-0005](0005-the-teams-verifier-owns-key-retrieval.md).

## Alternatives considered

- **`app.server.handleRequest({ body, headers })`, the public seam.** Rejected: it dispatches the
  activity into the SDK pipeline after validating and cannot return a typed refusal before
  delivery.
- **`jsonwebtoken` plus `jwks-rsa`, called directly.** Rejected: a new dependency, and a second
  statement of Microsoft's issuer, audience, key-set and `serviceurl` rules that would drift from
  the SDK's.
- **For unknown kids, one SDK check per minimum interval (a cooldown).** Rejected: it breaks the
  documented recovery from a key-set outage. A verifier whose first request meets a 503 would
  refuse the next genuine activity too, because that activity's kid is still unknown and the one
  slot was spent on the failed fetch. A budget of ten keeps a retry available.
- **Fetching the key set in the verifier and refusing any kid absent from it, on every request.**
  Rejected as the first line of defence: a second key-set read beside the SDK's on every cold
  start, and a URL rule that could drift from the SDK's. It was first rejected outright for that
  drift, without weighing that a budget alone lets forged tokens starve genuine ones. The verifier
  now reads the Bot Framework set only once the budget is spent, from the URL rule both 2.0.15 and
  2.1.0 apply, and the drift risk is pinned by tests that run the installed SDK against the same
  local key server.
- **One allowance per distinct unknown kid.** Rejected: it stops a repeated forged kid from
  starving a real one, but a sender who invents a fresh kid per request exhausts any total bound
  all the same. Telling a genuine new kid from an invented one before any fetch needs the
  published set.
- **`botframework-connector`.** Rejected: a new dependency from a different SDK generation.

## Verification

`packages/gateway-teams/tests/` holds the evidence: the installed 2.0.15 validator against a local
key server for the Bot Framework path, and an accepting validator through the `__validatorModule`
seam for the 2.1.x Entra path.
