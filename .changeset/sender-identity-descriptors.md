---
"@theokit/gateway-imessage": patch
"@theokit/gateway-raft": patch
"@theokit/gateway-tlon-urbit": patch
"@theokit/gateway-sms": patch
---

Declare `senderIdentity`: `"authenticated"` for iMessage, Raft and Tlon, and an unauthenticated reason (the caller id of a text message) for SMS.
