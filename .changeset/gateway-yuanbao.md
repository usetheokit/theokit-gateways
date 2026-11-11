---
"@theokit/gateway-yuanbao": minor
---

Add `@theokit/gateway-yuanbao`, a Tencent Yuanbao bot adapter.

`YuanbaoAdapter` verifies an HMAC-signed JSON webhook (`handleWebhook`), turns text messages into
messages and replies through the bot message API, splitting a reply over 2000 characters. Requires
`@theokit/gateway` 0.12.0 or later. Not yet run against a live account; the wire shapes are an
assumption.
