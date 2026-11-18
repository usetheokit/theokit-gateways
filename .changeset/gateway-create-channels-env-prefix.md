---
"@theokit/gateway": minor
---

Add `envVarName` and the optional `ChannelEntry.envPrefix`: `createChannels` and `configFromEnv` now build full environment variable names with the same helper, so a missing-config rejection names the same variables `configFromEnv` reports. Entries without `envPrefix` behave as before.
