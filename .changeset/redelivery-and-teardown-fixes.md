---
"@theokit/gateway-email": patch
"@theokit/gateway-matrix": patch
---

Two defects that only a real server could show, both found by the live suites.

**Email — the bot re-answered its whole unread inbox after every restart.** Nothing ever flagged a message as read on the server, and the only record of what had already been handled lived in memory and was thrown away on disconnect. So each reconnect fetched the entire unread backlog again and delivered all of it a second time: on the test mailbox, 166 messages meant 166 duplicate replies to the people who had written in. It got worse over time, because the backlog only ever grew. Messages are now flagged on the server once handled, in a single command per batch, so a restart picks up where it left off.

**Matrix — `disconnect()` could kill your process.** Shutting the client down cancels the requests it has open, and one of those cancellations surfaced as an unhandled rejection, which Node treats as fatal. An application that reconnects — the well-behaved kind, with retry on connection loss — could be terminated by its own clean shutdown. Measured against a real homeserver before the fix: 7 occurrences in 8 connect/disconnect cycles. Cancellations during shutdown are now contained, while any cancellation you request yourself through `getClient()` still reaches you unchanged.
