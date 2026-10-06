---
"@theokit/gateway-teams": minor
---

Export `teamsActivityVerifier`, which checks an inbound Teams activity on an app's own HTTP route.

`teamsActivityVerifier({ clientId, tenantId?, cloud? })` returns a function that reads a Fetch
`Request`, consuming its body (pass a `clone()` if you need the body again), and answers
`{ ok: true, activity, token }` or `{ ok: false, reason, message }`. It runs the Microsoft SDK's
own token validator, then checks the token's `aud`, `serviceurl` and tenant, and never throws for
a request. It refuses an unsigned, forged, expired or misdirected
activity, and with `tenantId` set a foreign-tenant one, with one of eight typed reasons.

Two refusals are deliberate: with `tenantId` set, a Bot Framework token with no `tid` claim is
`tenant_unverified`, and Microsoft documents none on connector tokens; an agentic-identity (Entra)
activity is `serviceurl_mismatch`, because its token carries no `serviceurl` claim.

The verifier reads at most 1 MiB of body and refuses a larger one as `malformed_body` before any
token work. It hands the SDK validator a silent logger, so a refused token writes nothing to the
host's logs. `validator_unavailable` also covers an SDK `check()` that fails with anything but its
own token refusal, and its message names the error's class and code, never the error's text.

Also exports the `TeamsActivityVerifierOptions`, `TeamsActivityVerifyResult` and
`TeamsCloudEndpoints` types. Additive: no existing export changes, no new dependency.
