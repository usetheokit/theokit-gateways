---
"@theokit/gateway-whatsapp": patch
---

`WhatsAppAdapter.onStatusReceipt` drops a status receipt addressed to another phone number id when
the adapter's backend declares its `phoneNumberId`, as the adapter already did for messages, and
names that id once on stderr by its last four digits. Before, a custom backend that declared its
number had its messages scoped and its receipts forwarded whole, so one number's receipt handler
saw the customer numbers of another number on the same Meta app. A backend that declares no number
forwards every receipt, as before.
