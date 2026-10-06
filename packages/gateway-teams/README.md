# `@theokit/gateway-teams`

Microsoft Teams platform adapter for `@theokit/gateway`. Built on the modern `@microsoft/teams.apps` v2 SDK.

Status: **v0.1.0 pre-release**. Pre-1.0 contract per ADR D324 — breaking changes allowed within 0.x.

## How inbound arrives

An activity reaches an app by one of two paths, and each one checks the Bot Framework token before
anything is delivered.

**The SDK's own HTTP server.** Mount the SDK on your server through the adapter's
`httpServerAdapter` option (an `ExpressAdapter` from `@microsoft/teams.apps`) and call
`adapter.connect()`. The SDK registers
`POST /api/messages`, validates the token itself, and activities reach `onInbound` from there.

**Your own route.** When the activity arrives on a route your app owns, verify it with
`teamsActivityVerifier` before you normalize and deliver it:

```ts
import { normalizeTeamsActivity, TeamsAdapter, teamsActivityVerifier } from "@theokit/gateway-teams";

const adapter = new TeamsAdapter({ clientId, clientSecret, tenantId });
adapter.onInbound(async (event) => {
  // handle the message
});
const verify = teamsActivityVerifier({ clientId });

export async function onTeamsRequest(request: Request): Promise<Response> {
  const result = await verify(request.clone());
  if (!result.ok) return new Response(result.reason, { status: 401 });
  const outcome = await adapter.deliver(normalizeTeamsActivity(result.activity));
  return new Response(null, { status: outcome === "ok" ? 200 : 500 });
}
```

The verifier runs the SDK's own token validator, so the signature, key-set and expiry rules stay
Microsoft's. It then checks three claims of the token the SDK accepted: `aud` must be this bot's
app id (or one of its `api://` forms), `serviceurl` must match the activity's `serviceUrl`, and the tenant must be the one you
configured; with no `tenantId`, a token issued by a specific Entra tenant is refused as
`tenant_unverified`. It never throws for a request; a refusal is `{ ok: false, reason, message }`,
and the message never contains the token. Building the verifier throws a `TypeError` for an empty
`clientId`, an empty `tenantId`, a `tenantId` of `common`, `organizations` or `consumers`, or a
`cloud` missing one of `loginEndpoint`, `tokenIssuer` and `openIdMetadataUrl`.

Two refusals follow from Microsoft's tokens rather than from a fault, and both are deliberate:

- **`tenant_unverified` on every Bot Framework activity when `tenantId` is set.** A verifier
  configured with `tenantId` refuses every Bot Framework activity whose token carries no `tid`
  claim, and Microsoft documents none on connector tokens. Omit `tenantId` on that path unless you
  have confirmed your tokens carry `tid`.
- **`serviceurl_mismatch` on agentic-identity activities.** Activities signed with an Entra-issued
  token (the agentic-identity path in `@microsoft/teams.apps` 2.1) are refused, because the
  platform signs no `serviceurl` claim on them, so nothing binds the token to the activity.

A key-set outage reads as `invalid_token`, the same as a forged token; the next request retries.
The key-set client and its timeout belong to the SDK, so a key set that never answers holds the
request until that timeout: bound the `verify` call with your route's own timeout.

What else to expect from the verifier:

- It reads at most 1 MiB of the body, before any token work, because the `serviceurl` check needs
  the activity. A larger body is refused as `malformed_body`. Your server may cap it lower.
- `validator_unavailable` means the SDK validator could not be loaded, or failed with something
  other than its own token refusal. The message names the error's class and code, never its text.
  A failed load is kept: that verifier refuses every request until you build a new one.
- It hands the SDK validator a silent logger, so a refused token writes nothing to your logs. The
  SDK would otherwise log claim values the sender chose. Log the `reason` yourself if you want a
  trace.
