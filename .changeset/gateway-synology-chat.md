---
"@theokit/gateway-synology-chat": minor
---

Add `@theokit/gateway-synology-chat`, a Synology Chat bot adapter.

`@theokit/gateway-synology-chat` (first release) exports `SynologyChatAdapter`, which takes a bot's
outgoing callbacks on its own listener (or a route on your Express app), checking each callback's
token in constant time, and replies through the bot's Incoming URL. A `post_id` already delivered is
not delivered again, bodies are capped at 1 MiB, and the Incoming URL, which holds a token, appears
in no error or log line. `express` is an optional peer, and `@theokit/gateway` 0.12.0 or later is
required. Not yet run against a NAS.
