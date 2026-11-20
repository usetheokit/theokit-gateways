---
"@theokit/gateway-wechat": minor
"@theokit/gateway-wecom": minor
"@theokit/gateway-teams": minor
---

The `wechatChannel`, `wecomChannel` and `teamsChannel` descriptors now declare `transport: "webhook"` with a `webhook.handle`, so a host mounts them with `createWebhookHandler`. WeChat and WeCom answer the server-URL check and verify the query signature, returning the adapter's status and body unchanged; Teams verifies the connector token with the client id alone and answers each refusal with its retry status. The Express listeners are unchanged.
