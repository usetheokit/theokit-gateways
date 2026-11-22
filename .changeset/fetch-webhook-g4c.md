---
"@theokit/gateway-google-chat": minor
"@theokit/gateway-yuanbao": minor
"@theokit/gateway-qq": minor
"@theokit/gateway-zalo": minor
---

Answer webhooks through the Fetch webhook contract: each descriptor declares `methods: ["POST"]` and a `handle`, so `createWebhookHandler` serves the route. `googleChatChannel` is now a `webhook` transport that builds its adapter with `webhook: "external"`.
