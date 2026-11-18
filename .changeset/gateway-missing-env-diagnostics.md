---
"@theokit/gateway": minor
---

`createChannels` rejections for missing required config now name each field's full environment variable, built with the same `envVarName` helper as `configFromEnv`. The new optional `ChannelEntry.envPrefix` matches the prefix given to `configFromEnv`; entries without it behave as before.
