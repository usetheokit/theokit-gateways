---
"@theokit/gateway": patch
---

Make `splitKeepingRows` measure only the straddled row instead of advancing a full part limit, so splitting long tables is faster.
