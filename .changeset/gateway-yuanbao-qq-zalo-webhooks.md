---
"@theokit/gateway-yuanbao": minor
"@theokit/gateway-qq": minor
"@theokit/gateway-zalo": minor
---

Export `yuanbaoChannel`, `qqChannel` and `zaloChannel`: webhook channel descriptors (`transport: "webhook"`) whose `webhook.verify` checks the platform signature and whose `webhook.ingest` dispatches the event. The adapters gain `verifyWebhook` and `dispatchWebhookPayload`; `handleWebhook` behaves as before.
