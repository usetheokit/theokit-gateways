---
"@theokit/gateway-slack": patch
---

A bad Slack bot or app token no longer crashes the process. `connect()` now stops Bolt from starting its own background token check, so a wrong credential resolves `false` without an unhandled rejection.
