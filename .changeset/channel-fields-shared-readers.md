---
"@theokit/gateway-email": patch
"@theokit/gateway-irc": patch
"@theokit/gateway-matrix": patch
"@theokit/gateway-nextcloud-talk": patch
"@theokit/gateway-signal": patch
---

The email, IRC, Matrix, Nextcloud Talk and Signal channel descriptors build their configuration fields with the shared `field` helper, and email and Matrix read their env-string numbers and booleans through one shared reader instead of two copies. The descriptors and the values they accept are unchanged.
