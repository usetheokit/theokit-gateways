---
"@theokit/gateway-wechat": patch
---

Harden webhook request validation. `handleWebhook` now answers 401 to a request whose timestamp
is more than 300 seconds from the server clock (`stale timestamp`) and to a message whose
timestamp and nonce were already accepted with a different body (`nonce reused`).
`verifyWeChatSignature` takes an optional `nowMs` and returns `false` for a stale timestamp. The
README states what plain mode does and does not authenticate.
