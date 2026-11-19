---
"@theokit/gateway-agent": minor
---

Add `createAgentHandler`, which answers a channel message with one SDK agent turn: exactly one reply (the answer, a no-answer text, or an error text), secrets masked across streamed frames, an optional ack reaction, and a typed `AgentTurnError` thrown after a failed turn so `on_error` hooks fire.
