---
"@theokit/gateway-discord": patch
---

Direct messages now reach the agent: the client enables the `Channel` partial, without which discord.js drops `messageCreate` for uncached DM channels.
