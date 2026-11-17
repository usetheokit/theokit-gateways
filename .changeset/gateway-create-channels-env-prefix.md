---
"@theokit/gateway": minor
---

`ChannelEntry` takes an optional `envPrefix`: when set, a `missing_required_config` rejection names each missing field by its full environment variable (`envPrefix` + `env`) instead of its config key.
