---
"@theokit/gateway-line": patch
"@theokit/gateway-sms": patch
---

The LINE and SMS webhook routes answer 413 to a request body over 1 MiB instead of buffering it without limit before the signature check.
