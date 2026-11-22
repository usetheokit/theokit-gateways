---
"@theokit/gateway": patch
---

`splitKeepingRows` now checks whether a straddled table row fits by scanning that row alone, not `partLimit` units from its start, so cutting a table costs about what a plain cut does.
