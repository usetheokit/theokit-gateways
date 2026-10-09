---
"@theokit/gateway-whatsapp": patch
---

`parseWebhookPayload` checks the nested shape of a Cloud webhook body and returns `null` when an
entry has no `changes` array, an entry or change is `null`, or a `messages`, `statuses` or
`contacts` list is not a list of objects. Before, such a body passed the check and then
`normalizeInboundMessages`, `normalizeStatusReceipts`, `toDeliverableEvents` and
`WhatsAppCloudBackend.handleWebhookPayload` threw a `TypeError`.

`WhatsAppCloudBackend.handleWebhookPayload` answers `false` for a signed body `parseWebhookPayload`
refuses (no `object`, no `entry` array, or a malformed entry, change or list), as it does for a
signed body that is not JSON, dispatches nothing and writes one line to stderr. Before, it answered
`true` for a body with no `object` or no `entry` array, so a route built on it answered 200 and
Meta never redelivered the batch.
