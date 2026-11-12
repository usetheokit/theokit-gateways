---
"@theokit/gateway-telegram": minor
---

`TelegramAdapter` takes `inbound: "webhook"`: `connect()` checks the token without starting long polling, and `disconnect()` does not call `bot.stop()`. Updates arrive through `deliver()`. The default stays `"polling"`.
