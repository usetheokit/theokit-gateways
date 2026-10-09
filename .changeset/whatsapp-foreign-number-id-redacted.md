---
"@theokit/gateway-whatsapp": patch
---

The stderr line written when a message addressed to another `phone_number_id` is dropped now names
that id by its last four digits, the way the allowlist refusal already names a sender, and names a
message with no id as `no phone number id`. Before, the line carried the id exactly as the
envelope gave it, so a route that hands `toDeliverableEvents` an unverified body could write a
forged line through it, and every distinct id was kept in memory for the life of the adapter. The
set of ids already reported now holds at most one entry per four-digit ending. A log query that
matched `phone number id "<id>"` needs to match `phone number id ending in <last four digits>`.
