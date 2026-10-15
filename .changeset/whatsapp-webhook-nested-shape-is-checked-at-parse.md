---
"@theokit/gateway-whatsapp": patch
---

`parseWebhookPayload` checks the nested shape of a Cloud webhook body and returns `null` when an
entry has no `changes` array, an entry or change is `null`, or a `messages`, `statuses` or
`contacts` list is not a list of objects. Before, such a body passed the check and then
`normalizeInboundMessages`, `normalizeStatusReceipts`, `toDeliverableEvents` and
`WhatsAppCloudBackend.handleWebhookPayload` threw a `TypeError`.

It also returns `null` when a field the inbound rules read is not a string: a
`metadata.phone_number_id` that is not absent or a string, or a text message whose `id`, `from` or
`text.body` is not a string. Before, a numeric or `null` `phone_number_id` made
`toDeliverableEvents` and `handleWebhookPayload` throw a `TypeError`, a numeric `from` threw under
`allowedSenders`, and a numeric `text.body` was delivered as a number.

`WhatsAppCloudBackend.handleWebhookPayload` answers `false` for a signed body `parseWebhookPayload`
refuses (no `object`, no `entry` array, or a malformed entry, change or list), as it does for a
signed body that is not JSON, dispatches nothing and writes one line to stderr. Before, it answered
`true` for a body with no `object` or no `entry` array, so a route built on it answered 200 and
Meta never redelivered the batch.
