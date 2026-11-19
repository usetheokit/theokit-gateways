---
"@theokit/gateway-yuanbao": patch
"@theokit/gateway-qq": patch
"@theokit/gateway-zalo": patch
---

Add `yuanbaoChannel`, `qqChannel` and `zaloChannel` descriptors with `transport: "webhook"` and a working `webhook.verify` and `webhook.ingest`, so a host mounts them with `createWebhookHandler`. QQ also answers its unsigned callback URL validation. The adapters gain `verifyWebhook` and `ingestPayload`; `handleWebhook` behaves as before.
