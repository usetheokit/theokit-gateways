---
"@theokit/gateway-whatsapp": minor
---

`WhatsAppStatusReceipt` gains an optional `phoneNumberId`: the `phone_number_id` a Cloud receipt was
addressed to, read from the webhook's `metadata`. `normalizeStatusReceipts` fills it; the web and
Baileys backends leave it absent.

`WhatsAppCloudBackend.handleWebhookPayload` now applies the own-number rule to status receipts as
well as to messages. Before, a receipt addressed to another number of the same Meta app, or naming
no number, still reached `onStatusReceipt`, and a receipt names the recipient's phone number, so in
a multi-number app one number's handler received another number's customer numbers. Such a receipt
is now dropped and its number id written to stderr once, as a message already was.

The README's Cloud route skips any receipt whose `phoneNumberId` is not the route's own number.
Additive: no existing field changes.
