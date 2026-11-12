---
"@theokit/gateway-qq": patch
---

Harden the QQ webhook input checks. A webhook body that is JSON but not an object, and a callback URL validation whose `plain_token` or `event_ts` is not in the expected token or timestamp shape, are now answered with 400.
