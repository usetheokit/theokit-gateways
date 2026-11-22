---
"@theokit/gateway": patch
---

`splitKeepingRows` decides whether a straddled table row fits a part by reading only that row, instead of walking `partLimit` units from the row's start first. With `unit: "codepoint"` that walk cost as much again as the cut itself on every part a row straddled, which put `gateway-nextcloud-talk`'s `splitForTalk` at 1.55x to 1.7x of the plain cut on a 1,000,000-character table in CI, past its 1.5x budget. The parts are the same.
