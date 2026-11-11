---
"@theokit/gateway-qq": minor
---

Add `@theokit/gateway-qq`, a QQ Bot adapter.

`QQAdapter` verifies the Ed25519-signed webhook (`handleWebhook`, which also answers the callback
URL validation), turns C2C text messages into direct-message events and replies through the QQ Bot
message API as passive replies, splitting a reply over 2000 characters. Direct messages only.
Requires `@theokit/gateway` 0.15.0 or later. The wire shapes are written from the QQ Bot open
platform docs and the adapter has not been run against a live QQ Bot.
