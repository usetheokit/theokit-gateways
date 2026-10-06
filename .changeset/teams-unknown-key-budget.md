---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` now limits how often a forged token can make the bot fetch Microsoft's key
set. The SDK fetches the key set for any token whose `kid` it has not cached, before it checks the
signature, so before this change every request carrying a made-up `kid` cost one outbound request.
Now a token with no `kid` is refused as `invalid_token` before the SDK, and at most 10 tokens a
minute whose `kid` no accepted token used reach the SDK. Past those 10, a token reaches the SDK only
if the published Bot Framework key set lists its `kid`; the verifier reads that set at most once
every 10 seconds, so forged tokens cannot keep a genuine key out for longer than that. Activities
signed with a key the verifier has already accepted are never limited. A token issued by an Entra
tenant the verifier would refuse is refused with that tenant reason before the SDK.
