---
"@theokit/gateway-twitch": patch
"@theokit/gateway-tlon-urbit": patch
---

The adapters import `SeenIds` from `@theokit/gateway` instead of carrying a copy; their peer floor
is now `>=0.13.0`.
