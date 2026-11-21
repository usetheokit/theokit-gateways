---
"@theokit/gateway": minor
---

`ChannelWebhook.verify` may return a `Promise<boolean>`, and `createWebhookHandler` awaits it.
