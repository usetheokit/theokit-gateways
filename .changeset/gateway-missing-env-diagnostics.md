---
"@theokit/gateway": patch
---

`createChannels` rejections for missing required config now name each field's environment variable; pass `envPrefix` on a `ChannelEntry` to match the prefix given to `configFromEnv`.
