---
"@theokit/gateway-qq": minor
---

Add `@theokit/gateway-qq`, a QQ Bot adapter.

`QQAdapter` verifies the signed webhook (`handleWebhook`: Ed25519 over timestamp and body, plus
the `op` 13 endpoint validation), turns direct messages (`C2C_MESSAGE_CREATE`) into messages and
replies through the C2C message API, splitting a reply over 2000 characters. Requires
`@theokit/gateway` 0.15.0 or later. Not yet run against a live QQ bot.
