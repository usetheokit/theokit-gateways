---
"@theokit/gateway-whatsapp": patch
---

An adapter constructed with `new WhatsAppAdapter(new WhatsAppCloudBackend(...))` now drops a
message addressed to another `phone_number_id`, as an adapter built with `fromCloud` already did.
Before, the check depended on which construction path built the adapter, so the same Cloud backend
admitted another number's messages when the adapter was constructed directly.
`WhatsAppCloudBackend.handleWebhookPayload` applies the same rule, so a route built on the backend
alone, with no adapter, no longer hands its inbound handler a message addressed to another number
of the same Meta app or naming no number.
`WhatsAppCloudBackend` exposes the number it answers for as `phoneNumberId`.
