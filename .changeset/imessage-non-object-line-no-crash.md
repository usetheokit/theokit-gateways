---
"@theokit/gateway-imessage": patch
---

A stdout line from `imsg` that parses to `null` (or any other non-object) no longer crashes the host process. The line is skipped and the client stays open.
