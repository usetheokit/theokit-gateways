---
"@theokit/gateway-whatsapp": patch
---

`parseWebhookPayload` returns `null` for a Cloud webhook body with a contact whose `wa_id` or
`profile.name` is not a string, or a status whose `id`, `status` or `recipient_id` is not a string.
Before, a contact name of `42` reached the agent as `sender.displayName` 42, and a status with a
numeric `id` became a receipt whose `wamid` was a number, though both fields are typed as strings.
`WhatsAppCloudBackend.handleWebhookPayload` answers `false` for such a body and dispatches nothing,
as it already does for the other shapes the parser refuses.
