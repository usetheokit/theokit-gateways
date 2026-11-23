---
"@theokit/gateway-agent": minor
---

`createAgentHandler` gains `decorateReply`, `onTurnEnd` and `onTurnStart`: append text to the single reply, observe each turn's final text, failure and usage, and reach the running turn by session.
