---
"@theokit/gateway": minor
---

`ChannelWebhook.verify` may return a `Promise<boolean>`, and `createWebhookHandler` awaits it.

`ChannelWebhook.precheck` answers a request from its method, URL and headers before the body is read.
