---
"@theokit/gateway-agent": minor
---

Add `createChatApprover`, which asks an owner in chat to `/approve`, `/approve always` or `/deny` a tool call. It denies on silence, on a failed send and when a question is already pending in the conversation, ignores non-owners, and never lets the answers reach the agent. Requires `@theokit/gateway` 0.19.0 or later.
