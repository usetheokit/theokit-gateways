---
"@theokit/gateway-yuanbao": minor
"@theokit/gateway-qq": minor
"@theokit/gateway-zalo": minor
---

`yuanbaoChannel`, `qqChannel` and `zaloChannel` bind their config fields to environment variables for `configFromEnv`, validate values with the package `ConfigurationError` (`invalid_config`), and expose optional endpoint overrides. Peer range on `@theokit/gateway` is now `>=0.20.0`. The Zalo access token variable is `ZALO_ACCESS_TOKEN`.
