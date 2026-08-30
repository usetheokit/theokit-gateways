---
"@theokit/gateway-slack": patch
---

Another bot's `thread_broadcast` no longer reaches the handler.

The loop guard read `bot_id !== undefined && subtype === "bot_message"`. The next line already
drops every subtype except `thread_broadcast`, so that condition was subsumed — deleting the whole
line left all 78 tests in the package green — and the single case it did not reach was a bot
broadcasting into a thread. `thread_broadcast` is allowed through on purpose, because a human
broadcasting a thread reply is a real message; a bot doing it is not, and it arrived at the agent.

Two agents in the same channel, both replying with broadcast, answer each other indefinitely.

The guard now drops a message that carries `bot_id` AND has no human author. Both halves matter: a
message from a bot has a `bot_id` and nobody behind it, while `chat.postMessage` with a USER token —
workflow posts, integrations, anything a person drives through an app — carries the app's `bot_id`
with the human named as the author. The first attempt dropped everything with `bot_id` and took
those with it; the live suite caught that in the release gate, and both directions now have a test.

Found by mutation testing: every mutant of that line survived, which is what a subsumed condition
looks like from the outside.
