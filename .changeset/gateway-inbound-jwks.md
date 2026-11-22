---
"@theokit/gateway-google-chat": patch
"@theokit/gateway-teams": patch
---

Verify inbound tokens with the core `jwksKeySet` and `verifyRs256Jwt` instead of an own key-set cache and RS256 check. Both adapters now need `@theokit/gateway` >=0.27.0, which ships them.
