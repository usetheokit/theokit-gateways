---
"@theokit/gateway-teams": minor
---

`teamsActivityVerifier` now reads Microsoft's published signing keys itself and checks a token's
RS256 signature before it asks the Teams SDK, so a forged token can no longer make the bot fetch
the key set. Before this change, a forged token that named one of the published keys (Microsoft
publishes far more than the 5 the SDK caches) still reached the SDK, and each one could cost a
request to Microsoft's key endpoint.

Now:

- the verifier reads the Bot Framework key set, and with `tenantId` set that tenant's key set,
  when it holds no copy or its copy lacks the token's `kid`, and never within 10 seconds of the
  end of its previous read of that set, whatever is sent;
- once its copy is an hour old it reads the set again in the background and answers a token whose
  `kid` the copy lists from that copy meanwhile, so a slow or hanging key endpoint adds no wait to
  genuine activities;
- a token whose header names anything but RS256, whose `kid` the set does not list, or whose
  signature does not verify is refused as `invalid_token` without asking the SDK;
- forged traffic, whatever `kid` it names, cannot delay a genuine activity, Bot Framework or
  tenant-issued.

**New refusal reason: `key_set_unavailable`.** `TeamsActivityVerifyResult` gains it. It means the
key set could not be read (and the copy held, if any, does not list the token's key), so the token
could not be checked. It is also the answer when the token's signature verified and the SDK, which
still reads the key through its own client, could not read it. It used to read as `invalid_token`,
the same as a forgery. It is retryable: answer it with a 503 so the Bot Framework retries. Code
that switches exhaustively over `reason` needs the new case.

The cost: on a cold start the key set is read twice, once by the verifier and once by the SDK,
which still checks issuer, audience, expiry and `serviceurl`. No new dependency (`node:crypto`
only). ADR-0005 records the decision.
