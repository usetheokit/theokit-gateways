---
"@theokit/gateway-zalo": patch
"@theokit/gateway-wechat": patch
"@theokit/gateway-wecom": patch
"@theokit/gateway-synology-chat": patch
---

Compare webhook signatures and callback tokens with the core `verifyDigest` and `safeEqualString` instead of local `timingSafeEqual` copies. Raises the `@theokit/gateway` peer floor to `>=0.27.0`.
