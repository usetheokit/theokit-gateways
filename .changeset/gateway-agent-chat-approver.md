---
"@theokit/gateway-agent": minor
---

Add `createChatApprover`: asks an owner in the chat to `/approve`, `/approve always` or `/deny` a tool call and waits. Silence, a failed send, an unknown conversation and a second question in the same conversation all deny; non-owners are refused; the answer commands never reach the agent. Raises the `@theokit/gateway` peer floor to 0.19.0 for `parseChatCommand`.
