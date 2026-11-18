---
"@theokit/gateway": minor
---

`ChannelEntry` takes an optional `envPrefix`; `createChannels` then names a missing required field by its full environment variable (for example `APP_BUZZ_TOKEN`) in the `missing_required_config` rejection.
