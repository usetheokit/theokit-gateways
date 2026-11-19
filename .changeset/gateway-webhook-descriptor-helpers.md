---
"@theokit/gateway": minor
"@theokit/gateway-qq": patch
"@theokit/gateway-yuanbao": patch
"@theokit/gateway-zalo": patch
---

`@theokit/gateway` exports `webhookHeader` and `ingestResultForStatus`, which the QQ, Yuanbao and Zalo descriptors share, and those packages raise their `@theokit/gateway` peer floor to `>=0.21.0` to use them and `channelConfigReaders`.
