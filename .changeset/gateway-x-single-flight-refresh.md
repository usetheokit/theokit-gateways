---
"@theokit/gateway-x": patch
---

Concurrent calls no longer spend the same OAuth refresh token. `XApi.refresh()` now shares one in-flight token request, so a poll and a reply that both need a new access token make a single POST and get the same token.
