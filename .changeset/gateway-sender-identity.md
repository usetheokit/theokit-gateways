---
"@theokit/gateway": minor
"@theokit/gateway-telegram": minor
"@theokit/gateway-line": minor
---

Channel descriptors can declare `senderIdentity` (`"authenticated"` or `{ unauthenticated: reason }`), and `isAuthenticatedSender` reads it, failing closed when absent. `telegramChannel` and `lineChannel` declare `"authenticated"`.
