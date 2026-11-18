---
"@theokit/gateway-whatsapp": minor
"@theokit/gateway-sms": minor
---

The `whatsappChannel` Cloud variant and `smsChannel` descriptors now declare `transport: "webhook"` with a `webhook.handle`, so a host mounts them with `createWebhookHandler`. WhatsApp answers Meta's subscription check and verifies `x-hub-signature-256`; SMS verifies Twilio's signature against the configured `publicUrl`. The Express listeners are unchanged.
