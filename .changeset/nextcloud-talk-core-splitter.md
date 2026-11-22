---
"@theokit/gateway-nextcloud-talk": patch
---

`splitForTalk` now calls core `splitKeepingRows` with the code-point unit instead of its own copy, and the `@theokit/gateway` peer floor rises to 0.26.0, the release that ships that option. Core cuts at grapheme boundaries, the old copy cut at code points: a part that used to end inside a ZWJ emoji or a flag now ends before it.
