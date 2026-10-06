# ADR-0003: The Teams activity verifier calls the SDK validator by its `dist` path

- Status: Accepted
- Date: 2026-10-06
- Deciders: gateway cluster maintainers
- Evidence: the `gateway-teams-inbound-verifier` plan and its alignment brief, measured 2026-10-06

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
- **Unknown signing keys are budgeted.** The SDK's key client (`jwks-rsa` 3.x, built with
  `rateLimit: false`) caches only keys it found, and `jsonwebtoken` asks it for the key before any
  signature, algorithm or expiry check. So each token naming a `kid` the cache lacks was one
  request to Microsoft's key endpoint, for a value an unauthenticated sender chose: 20 forged
  tokens with fresh kids made 20 key-set requests (finding #60, measured 2026-10-06). The verifier
  now reads the `kid` from the unverified header and lets at most 10 tokens per fixed 60-second
  window reach the SDK when their kid is one no accepted token used; the rest are `invalid_token`
  with no request. A kid is learned only when the SDK accepted its token, and a learned kid is
  never limited. Ten a minute is `jwks-rsa`'s own `jwksRequestsPerMinute` default. The cost: a
  sender who spends the budget can delay, by up to a minute, the first activity signed with a key
  this verifier has not yet seen (at startup, or after Microsoft rotates its keys). Activities
  under keys already seen are unaffected. The budget is per verifier, not per client; a per-client
  rate limit in front of the route remains the operator's.
- The verifier hands the SDK validator a silent logger. Without one, the SDK's default
  `ConsoleLogger` writes an error line for every token it refuses, with claim values the sender
  chose, so a flood of forged requests would become log volume an unauthenticated sender writes.
  The cost is that the SDK's own diagnostics are gone; the refusal reason is what remains.
- The control test in `packages/gateway-teams/tests/` deep-imports `ServiceTokenValidator`; a
  lockfile bump to an SDK without that name fails it at load, which fails closed.

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
- **Fetching the key set in the verifier and refusing any kid absent from it.** Rejected: a
  second key-set client beside the SDK's, which must also know which key set each path uses (Bot
  Framework or, on 2.1.x, Entra); the same drift the direct `jwks-rsa` alternative was rejected for.
- **`botframework-connector`.** Rejected: a new dependency from a different SDK generation.

## Verification

`packages/gateway-teams/tests/` holds the evidence: the installed 2.0.15 validator against a local
key server for the Bot Framework path, and an accepting validator through the `__validatorModule`
seam for the 2.1.x Entra path.
