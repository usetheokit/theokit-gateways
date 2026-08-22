---
"@theokit/gateway-slack": minor
---

**Slack — a routine reconnect from Slack could kill your process, and shutting down mid-connect leaked a socket.**

Slack periodically asks a Socket Mode client to refresh its connection. When that message arrived while the socket was still opening, the state machine inside `@slack/socket-mode` 1.x had no transition for it and threw `Unhandled event 'server explicit disconnect' in state 'connecting'`. It threw from an asynchronous websocket handler, so nothing in this adapter — or in your application — could catch it: it surfaced as an unhandled rejection, which Node treats as fatal. Observed on 2 of 3 consecutive live runs, where it turned a fully green test suite into a red job (#31).

The defect was never in this adapter, and there is no way to guard it from the outside. It was fixed upstream by deleting the state machine: `@slack/socket-mode` 2.x dropped the `finity` dependency entirely, and handles Slack's refresh message by simply closing the websocket. So the peer requirement moves to **`@slack/bolt` `^4.0.0 || ^5.0.0`**, the versions that carry a fixed socket-mode. Both were verified here against the adapter's full suite.

This is a breaking change for anyone on Bolt 3: upgrade `@slack/bolt` alongside this package. Nothing in this adapter's own API changed — the same options, the same methods, the same events. Note that Bolt 5 pulls `@slack/socket-mode` 3.x, which needs `undici` `^7`; Bolt 4 has no such requirement.

**`disconnect()` during an in-flight `connect()` stopped nothing.** The guard tested a `connected` flag that only flips after both `app.start()` and `auth.test()` resolve, so a shutdown arriving in that window returned immediately while the socket was still opening — and once `connect()` finished, no reference remained that could close it. It now waits for the in-flight connect and tears down the App itself, so a half-connected client is closed rather than left running. `disconnect()` before any `connect()`, and repeated calls, stay no-ops as before.
