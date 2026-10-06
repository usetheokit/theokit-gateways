---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` now limits how often a forged token can make the bot fetch Microsoft's key
set. The SDK fetches the key set for any token whose `kid` it has not cached, before it checks the
signature, so before this change every request carrying a made-up `kid` cost one outbound request.
Now at most 10 tokens a minute whose `kid` no accepted token used reach the SDK; the rest are
refused as `invalid_token` with no key-set request. Activities signed with a key the verifier has
already accepted are never limited. A sender who spends the budget can delay by up to a minute the
first activity under a key the verifier has not seen yet.
