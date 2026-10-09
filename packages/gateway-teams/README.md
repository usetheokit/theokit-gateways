# `@theokit/gateway-teams`

Microsoft Teams platform adapter for `@theokit/gateway`. Built on the modern `@microsoft/teams.apps` v2 SDK.

Status: **v0.1.0 pre-release**. Pre-1.0 contract per ADR D324: breaking changes allowed within 0.x.

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

/** The status each refusal gets. */
function refusalStatus(reason: string): number {
  // The verifier itself could not judge the token: let Microsoft retry.
  if (reason === "key_set_unavailable" || reason === "validator_unavailable") return 503;
  // Something read the body before the verifier: a bug in this route, which no retry clears.
  if (reason === "body_already_read") return 500;
  return reason === "malformed_body" ? 400 : 401;
}

export async function onTeamsRequest(request: Request): Promise<Response> {
  const result = await verify(request);
  if (!result.ok) {
    const status = refusalStatus(result.reason);
    if (status >= 500) {
      // A fault on this side or Microsoft's: the message says what failed, never the token.
      console.error(`teams verifier refused (${result.reason}): ${result.message}`);
    } else {
      // A sender fault: log the reason only, never the token or a claim value.
      console.warn(`teams verifier refused (${result.reason})`);
    }
    return new Response(result.reason, { status });
  }
  const outcome = await adapter.deliver(normalizeTeamsActivity(result.activity));
  return new Response(null, { status: outcome === "ok" ? 200 : 500 });
}
```

The verifier checks the token's RS256 signature against Microsoft's published keys, then runs the
SDK's own token validator, so the issuer, audience and expiry rules stay Microsoft's. It then checks three claims of the token the SDK accepted: `aud` must be this bot's
app id (or one of its `api://` forms), `serviceurl` must match the activity's `serviceUrl`, and the tenant must be the one you
configured; with no `tenantId`, a token issued by a specific Entra tenant is refused as
`tenant_unverified`. The activity's `channelId` must be `msteams`: one bot's connector tokens are
not bound to a channel, so a genuine token also arrives with activities from the bot's Web Chat and
Direct Line channels (on by default for an Azure Bot resource), where the client sets `from` and
`channelData`. Such an activity, or one with no `channelId`, is refused as `channel_mismatch`, a
client fault to answer with a 4xx (the example's 401). The Azure portal's "Test in Web Chat"
(`webchat`) and the Bot Framework Emulator (`emulator`) are refused the same way: test in Teams.
It never throws for a request; a refusal is `{ ok: false, reason, message }`,
and the message never contains the token. Building the verifier throws a `TypeError` for an empty
`clientId`, an empty `tenantId`, a `tenantId` of `common`, `organizations` or `consumers`, a
`cloud` missing one of `loginEndpoint`, `tokenIssuer` and `openIdMetadataUrl` or with one that is
not an `https:` URL (`http:` is accepted only on `localhost`, `127.0.0.1` or `[::1]`, since the
verifier reads its signing keys from these endpoints), a `loginEndpoint` ending in a slash, or an
`openIdMetadataUrl` that does not end in `/openidconfiguration` (no trailing slash, no query): the
key-set URL is that URL with the suffix replaced by `/keys`, as in the SDK's own cloud values, and
the OIDC-standard `/.well-known/openid-configuration` spelling would otherwise be fetched as the
key set and refuse every request.

Two refusals follow from Microsoft's tokens rather than from a fault, and both are deliberate:

- **`tenant_unverified` on every Bot Framework activity when `tenantId` is set.** A verifier
  configured with `tenantId` refuses every Bot Framework activity whose token carries no `tid`
  claim, and Microsoft documents none on connector tokens. Omit `tenantId` on that path unless you
  have confirmed your tokens carry `tid`.
- **`serviceurl_mismatch` on agentic-identity activities.** Activities signed with an Entra-issued
  token (the agentic-identity path in `@microsoft/teams.apps` 2.1) are refused, because the
  platform signs no `serviceurl` claim on them, so nothing binds the token to the activity.

The verifier reads Microsoft's published key sets itself, from the URLs the SDK uses: the Bot
Framework set (from your `cloud`'s `openIdMetadataUrl`) and, only when `tenantId` is set,
`{loginEndpoint}/{tenantId}/discovery/v2.0/keys`. It reads a set when it holds no copy or its
copy lacks the token's `kid`, and starts a read in the background when its copy is an hour old,
answering from that copy meanwhile, so a slow or hanging key endpoint adds no wait to a token
whose key it already holds. No read starts within 10 seconds of the end of the previous one, per
set, whatever is sent. A key endpoint that answers with a redirect is a failed read: keys come
only from the URL your `cloud` names. A token whose header names anything but RS256, whose `kid` the
set does not list, or whose signature does not verify is refused as `invalid_token` before the SDK
is asked, so a forged token never makes the bot fetch the key set. A key Microsoft has just
published can be refused for up to 10 seconds. A token issued by an Entra tenant this verifier
would refuse (another tenant, or any tenant when no `tenantId` is set) is refused with that tenant
reason before the SDK.

`key_set_unavailable` means the key set could not be read and the copy held, if any, does not
list the token's key: the token could not be checked. Answer it with a 503, as the example does,
so the Bot Framework retries; a cold start during a key-set outage refuses this way until a read
succeeds, at most one read every 10 seconds. Its message names the key set, its URL and why the
latest read failed: an HTTP status, no answer within 10 s, a network error code (for example
`ECONNREFUSED`), or a document that is too large, is not JSON, has no `keys` array, lists too many
keys or lists no usable RSA key. A document with no usable RSA key (an empty `keys` array, or only
keys of another type) is a failed read like the others: the copy held is kept, so it cannot turn
genuine tokens into `invalid_token`. A 404 or a `keys`-less document points at your `cloud` configuration, not at Microsoft. The SDK still reads the key through its own client
for a token whose signature verified (its client keeps a key for 10 minutes), and when that read
fails the answer is also `key_set_unavailable`, not `invalid_token`. That read and its timeout
belong to the SDK, so bound the `verify` call with your route's own timeout. The limits are per verifier, not per client: put your own
per-client rate limit in front of the route as well (ADR-0003, ADR-0005).

What else to expect from the verifier:

- It reads at most 1 MiB of the body, before any token work, because the `serviceurl` check needs
  the activity. A larger body is refused as `malformed_body`, and so is a body whose stream fails
  part-way through the read. Your server may cap it lower.
- Pass it a request whose body nothing has read. The example passes the request itself because it
  reads the activity from the result; if your route reads the body too, pass `request.clone()`,
  taken before anything reads it (`clone()` throws a `TypeError` on a body already read). A
  request whose body was already read, or is locked by
  another reader (a framework or middleware that consumed it first), is `body_already_read`: the
  fault is the route's, not the sender's and not the validator's, and a retry fails the same way
  until the route is fixed, so the example answers it with a 500 rather than a 503 that would
  have the Bot Framework retry it. Its message says the body was already read and to pass an
  unread request. A POST with no body at all is the sender's `malformed_body`.
- `validator_unavailable` means the SDK validator could not be loaded or failed with something
  other than its own token refusal. The message names the error's class and code, never its
  text. A failed load is kept: that verifier refuses every request until you build a new one.
- It hands the SDK validator a silent logger, so a refused token writes nothing to your logs. The
  SDK would otherwise log claim values the sender chose. The example logs the `reason` of every
  refusal instead, so refusals can be counted by reason, and the `message` only for the 5xx ones:
  neither ever holds the token or a claim value.
