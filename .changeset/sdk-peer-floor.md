---
"@theokit/gateway": patch
"@theokit/gateway-agent": patch
---

Raise the `@theokit/sdk` peer floor from `2.18.0` to `4.62.0`: `@theokit/sdk@2.18.0` publishes declarations that reference names it never defines, so a consumer at the old floor failed declaration checking (#584).
