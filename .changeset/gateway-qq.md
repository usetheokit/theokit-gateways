---
"@theokit/gateway-qq": minor
---

Add `@theokit/gateway-qq`, a QQ Bot adapter over the QQ Bot gateway WebSocket and OpenAPI v2.

`QQAdapter` exchanges the AppID and AppSecret for an access token, keeps the gateway WebSocket
open (heartbeat, resume and reconnect), turns C2C and group @-mention messages into events and
replies through the C2C and group message endpoints. Requires `@theokit/gateway` 0.12.0 or later.
The adapter is not yet run against a live QQ Bot account.
