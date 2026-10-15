---
"@theokit/gateway-whatsapp": patch
---

`WhatsAppCloudBackend.handleWebhookPayload` answers `false` for a signed body that holds a message
for the backend's number while no inbound handler is subscribed (before `onInbound`, or after
`disconnect()` cleared it), dispatches nothing and writes one line to stderr naming the count.
Before, it answered `true`, so a route answered 200, Meta did not redeliver, and the messages were
lost with nothing logged. Status receipts with no status handler are still discarded, and a body
whose messages are all for another number still answers `true`.
