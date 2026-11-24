---
"@theokit/gateway-sms": patch
---

`placeCall` accepts inline `twiml` as an alternative to `url`, times out after `timeoutMs` (default 15 000), refuses redirects, and reports Twilio's error message with the status.
