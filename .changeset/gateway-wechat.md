---
"@theokit/gateway-wechat": minor
---

Add `@theokit/gateway-wechat`, a WeChat (Weixin) Official Account adapter.

`WeChatAdapter` verifies the server-URL signature (`handleWebhook`), turns text messages into
messages and replies through the customer-service message API, splitting a reply over 600
characters. Requires `@theokit/gateway` 0.12.0 or later. Not yet run against a live account.
