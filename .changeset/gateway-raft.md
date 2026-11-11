---
"@theokit/gateway-raft": minor
---

Add `@theokit/gateway-raft`, a Raft External Agent adapter over the Raft CLI wake bridge.

`RaftAdapter` runs `raft wake --json`, turns each wake line into a message and replies through
`raft reply`. Requires `@theokit/gateway` 0.12.0 or later. The CLI wire contract is an assumption
and the adapter is not yet run against a live Raft account.
