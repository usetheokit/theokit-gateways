---
"@theokit/gateway-qq": patch
"@theokit/gateway-yuanbao": patch
"@theokit/gateway-x": patch
"@theokit/gateway-google-chat": patch
---

Cache access tokens with the core `createTokenCache`, so concurrent sends with an empty cache make one token request. Raises the `@theokit/gateway` peer floor to `>=0.26.0`.
