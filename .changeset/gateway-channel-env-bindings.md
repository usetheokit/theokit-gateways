---
"@theokit/gateway-telegram": minor
"@theokit/gateway-line": minor
"@theokit/gateway-discord": minor
"@theokit/gateway-slack": minor
---

Ship `ChannelDescriptor`s with env bindings for `configFromEnv`: `discordChannel` and `slackChannel` are new, and `telegramChannel` and `lineChannel` gain `env` names. `create` accepts comma-separated list strings and `"true"`/`"false"` strings.
