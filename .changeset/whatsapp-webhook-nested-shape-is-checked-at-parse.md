---
"@theokit/gateway-whatsapp": patch
---

`parseWebhookPayload` now checks the nested shape of a Cloud webhook body and returns `null` when
an entry has no `changes` array, an entry or change is `null`, or a `messages`, `statuses` or
`contacts` list is not a list of objects. Before, such a body passed the check and then
`normalizeInboundMessages`, `normalizeStatusReceipts`, `toDeliverableEvents` and
`WhatsAppCloudBackend.handleWebhookPayload` threw a `TypeError`, which a route answered with a 500
and Meta redelivered.
