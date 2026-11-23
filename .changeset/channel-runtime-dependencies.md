---
"@theokit/gateway": minor
"@theokit/gateway-x": minor
"@theokit/gateway-whatsapp": minor
---

`configFromEnv` takes `{ prefix, rename, require, enabledBy }` (a string prefix still works), and a descriptor's `create(config, deps)` receives runtime dependencies from `ChannelEntry.deps`. The X descriptor reads `credentialStore`; the WhatsApp baileys variant reads `onQr` and `connectTimeoutMs`.
