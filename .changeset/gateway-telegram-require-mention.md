---
"@theokit/gateway-telegram": minor
---

Add a `requireMention` option: when true, group messages reach the handler only if they mention the bot, reply to it or are slash commands, on both the polled and the `deliver()` paths. Default false.
