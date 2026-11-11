---
"@theokit/gateway-qq": minor
---

Add `@theokit/gateway-qq`, a QQ Bot adapter.

`QQAdapter` exchanges AppID and AppSecret for an access token, follows the QQ Bot WebSocket
gateway (identify, heartbeat, reconnect), turns direct (`C2C_MESSAGE_CREATE`) and group-@ messages
into messages, and replies through the OpenAPI v2 message endpoints as a passive reply, splitting a
reply over 1500 characters. Requires `@theokit/gateway` 0.12.0 or later. Not yet run against a
live bot.
