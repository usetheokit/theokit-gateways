---
"@theokit/gateway-whatsapp": patch
---

The stderr line written when a Cloud message that is not text is ignored now names its type only
when the type is one Meta documents (`image`, `audio`, `sticker` and the rest); any other value is
named `an unknown type`. Before, the line carried `type` exactly as the envelope gave it, so a route
that hands `toDeliverableEvents` an unverified body could write a forged line through it, and every
distinct type was kept in memory for the life of the process. The set of types already reported now
holds at most one entry per known type plus one for `an unknown type`.
