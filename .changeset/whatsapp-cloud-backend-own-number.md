---
"@theokit/gateway-whatsapp": patch
---

An adapter constructed with `new WhatsAppAdapter(new WhatsAppCloudBackend(...))` now drops a
message addressed to another `phone_number_id`, as an adapter built with `fromCloud` already did.
Before, the check depended on which construction path built the adapter, so the same Cloud backend
admitted another number's messages when the adapter was constructed directly.
`WhatsAppCloudBackend` exposes the number it answers for as `phoneNumberId`.
