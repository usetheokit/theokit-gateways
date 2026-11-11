---
"@theokit/gateway": minor
"@theokit/gateway-discord": minor
"@theokit/gateway-slack": minor
"@theokit/gateway-telegram": minor
"@theokit/gateway-matrix": minor
---

`BasePlatformAdapter` gains `react(channelId, messageId, emoji)`, which adds an emoji reaction to an inbound message. The default resolves `react_unsupported`; the Discord, Slack, Telegram and Matrix adapters implement it.
