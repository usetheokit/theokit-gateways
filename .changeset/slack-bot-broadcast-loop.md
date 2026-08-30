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

The guard now drops any message carrying `bot_id`, which is what "bot loop guard" was always meant
to say. A human `thread_broadcast` is unaffected and has its own test.

Found by mutation testing: every mutant of that line survived, which is what a subsumed condition
looks like from the outside.
