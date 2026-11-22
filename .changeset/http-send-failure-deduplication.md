---
"@theokit/gateway-qq": patch
"@theokit/gateway-yuanbao": patch
"@theokit/gateway-zalo": patch
---

Share the HTTP failure handling (non-2xx answers, rejected fetches, send-error mapping) in one internal module instead of three copies. No behaviour change.
