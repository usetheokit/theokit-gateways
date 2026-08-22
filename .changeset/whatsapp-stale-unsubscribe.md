---
"@theokit/gateway-whatsapp": patch
---

**A stale unsubscribe no longer deafens the adapter.** The function `onInbound` returned called whichever backend handle was *current* rather than the one it owned, so `onInbound(A)` → `onInbound(B)` → `A.off()` tore down **B's** subscription and nulled the handler. The adapter then received nothing, with no error and no crash — the worst way for a message bus to fail, because there is nothing in a log to see and nothing to alert on. It is now identity-guarded, and so is `onStatusReceipt`.

Worth naming: this is precisely the defect the cross-adapter contract test exists to catch, and this adapter was exempted from it by a comment asserting its mechanism was "a different mechanism with the same guarantee". It had no guard at all. The exemption is removed — the one adapter the gate excused turned out to be the one carrying the defect, which is what an exemption written from a reading of the code rather than a test of it eventually becomes.
