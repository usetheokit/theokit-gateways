---
"@theokit/gateway-teams": minor
---

Export `teamsActivityVerifier`, which checks an inbound Teams activity on a route the app owns,
and its types `TeamsActivityVerifierOptions`, `TeamsActivityVerifyResult` and
`TeamsCloudEndpoints`. Additive: no existing export changes, and no new dependency (`node:crypto`
only).

`teamsActivityVerifier({ clientId, tenantId?, cloud? })` returns a function that reads a Fetch
`Request`, consuming its body, and answers `{ ok: true, activity, token }` or
`{ ok: false, reason, message }`. It never throws for a request, and a refusal's message never
contains the token. It accepts an activity only when:

- the token's RS256 signature verifies under a key Microsoft publishes, checked by the verifier
  itself before the Teams SDK is asked, so a forged token never makes the bot fetch a key set;
- the Microsoft SDK's own token validator accepts the token, so issuer, audience and expiry stay
  Microsoft's rules;
- the token's `aud` is this bot's app id, its `serviceurl` matches the activity's `serviceUrl`,
  and its tenant is the configured one;
- the activity's `channelId` is `msteams`. A connector token is issued for the bot, not for one
  channel, so a genuine token also arrives from the bot's Web Chat and Direct Line channels, where
  the client sets `from` and `channelData`.

A refusal carries one of eleven reasons: `missing_authorization`, `malformed_body`,
`body_already_read`, `validator_unavailable`, `invalid_token`, `key_set_unavailable`,
`audience_mismatch`, `serviceurl_mismatch`, `channel_mismatch`, `tenant_mismatch` and
`tenant_unverified`. Three of them are not the sender's fault: `key_set_unavailable` and
`validator_unavailable` mean the verifier could not judge the token and a retry may succeed (the
README route answers 503), and `body_already_read` means something read the request body before
the verifier, which no retry clears (500). The README route logs the reason of every refusal.

The verifier reads Microsoft's key sets itself: the Bot Framework set, and with `tenantId` that
tenant's set. It reads a set when it holds no copy or its copy lacks the token's `kid`, and in the
background once its copy is an hour old, answering from that copy meanwhile. No read starts within
10 seconds of the end of the previous one, per set, whatever is sent, and both intervals are
measured on the monotonic clock. A failed read keeps the last good copy; a document listing no
usable RSA key counts as a failed read, and so does a redirect. A `key_set_unavailable` message
names the set, its URL and why its latest read failed. When the SDK, which still reads the key
through its own client, reports that it could not read it, the answer is also
`key_set_unavailable`.

It reads at most 1 MiB of body before any token work; a larger body, one that fails part-way, a
POST with no body, or a body that is not a JSON activity with a `serviceUrl` is `malformed_body`.
It hands the SDK validator a silent logger, so a refused token writes nothing to the host's logs.
A failed SDK load is kept, and that verifier refuses every request as `validator_unavailable`
until it is rebuilt.

Construction throws a `TypeError` for an empty `clientId`; an empty `tenantId` or one of `common`,
`organizations` and `consumers`; a `cloud` missing one of its three endpoints or with one that is
not an `https:` URL (`http:` is accepted only on `localhost`, `127.0.0.1` and `[::1]`); a
`cloud.loginEndpoint` ending in a slash; and a `cloud.openIdMetadataUrl` that does not end in
`/openidconfiguration`.

Two refusals are deliberate: with `tenantId` set, a Bot Framework token with no `tid` claim is
`tenant_unverified`, and Microsoft documents none on connector tokens; an agentic-identity (Entra)
activity is `serviceurl_mismatch`, because its token carries no `serviceurl` claim. ADR-0003 and
ADR-0005 record the decisions.
