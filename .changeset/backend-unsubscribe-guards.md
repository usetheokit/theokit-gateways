---
"@theokit/gateway-whatsapp": patch
---

**`WhatsAppCloudBackend` and `WhatsAppWebBackend` now identity-guard their unsubscribes.** Both are public exports implementing the exported `WhatsAppBackend` interface, so a consumer holding a backend directly — rather than going through `WhatsAppAdapter` — hit `onInbound(A)` → `onInbound(B)` → `A.off()` and stopped receiving anything, with no error and no crash. The Baileys backend had the guard; its two siblings never did.

The reason the gap survived is worth more than the fix: the cross-adapter contract test checked this invariant **per package**, so one compliant file covered every other file beside it. It now checks per declaration.
