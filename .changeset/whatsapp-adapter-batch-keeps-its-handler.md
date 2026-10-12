---
"@theokit/gateway-whatsapp": patch
---

`WhatsAppAdapter` now delivers every message of a signed Cloud batch to the inbound handler that
was subscribed when the batch arrived. The backend already did this, but the adapter looked up its
current handler again for each message, so a `disconnect()` or an unsubscribe inside the handler of
the first message dropped the rest of the batch while the webhook still answered 200, and Meta did
not redeliver the dropped messages. A batch that arrives after the unsubscribe still reaches no one.
