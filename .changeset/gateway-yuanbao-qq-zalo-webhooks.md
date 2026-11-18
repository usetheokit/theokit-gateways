---
"@theokit/gateway-yuanbao": minor
"@theokit/gateway-qq": minor
"@theokit/gateway-zalo": minor
---

Export `yuanbaoChannel`, `qqChannel` and `zaloChannel`: `transport: "webhook"` channel descriptors with signature `verify` and verified-payload `ingest` (QQ also handles the unsigned callback URL validation). The adapters gain `verifyWebhook` and `dispatchWebhookPayload`.
