---
"@theokit/gateway": patch
---

`createChannels` now builds the environment variable names in its missing-config rejections with the same internal `envVarName` helper as `configFromEnv`, so both report the same full names.
