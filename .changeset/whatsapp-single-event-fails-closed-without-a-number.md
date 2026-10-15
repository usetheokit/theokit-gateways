---
"@theokit/gateway-whatsapp": patch
---

`WhatsAppAdapter.toDeliverableEvent(inbound)` throws `ConfigurationError` (`missing_phone_number_id`)
for a Cloud message when the adapter's backend declares no `phoneNumberId`, as
`toDeliverableEvents(envelope)` already did. Before, the single-message method skipped the number
check on such an adapter, so a route building events one message at a time over a backend that
wraps `WhatsAppCloudBackend` delivered every number's messages to one agent. WhatsApp Web and
Baileys messages still convert, and the `onInbound` path is unchanged (see docs/adr/0006).
