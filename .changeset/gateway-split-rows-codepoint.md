---
"@theokit/gateway": minor
---

`splitKeepingRows` takes an optional `{ unit: "utf16" | "codepoint" }` so `partLimit` can be measured in code points. `SplitKeepingRowsOptions` is exported.

`splitKeepingRows` now checks whether a straddled table row fits by scanning that row alone, not `partLimit` units from its start, so a table cut costs about what a plain cut does.
