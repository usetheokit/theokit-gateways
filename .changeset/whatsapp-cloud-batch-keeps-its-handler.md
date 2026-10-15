---
"@theokit/gateway-whatsapp": patch
---

`WhatsAppCloudBackend.handleWebhookPayload` delivers every message of a signed batch to the inbound
handler that was subscribed when the batch arrived. Before, the handler was looked up again for each
message, so a `disconnect()` or an unsubscribe inside the handler of the first message skipped the
rest of the batch with nothing on stderr, and the method still answered `true`: the route answered
200 and Meta did not redeliver the skipped messages.
