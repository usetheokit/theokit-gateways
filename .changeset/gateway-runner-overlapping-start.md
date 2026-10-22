---
"@theokit/gateway": patch
---

Two overlapping `start()` calls on one `GatewayRunner` now share one connect. A call made while
the first is still connecting no longer connects every adapter again; both calls resolve the same
`StartResult`, or reject with the same error. A start that rejects is not remembered, so a later
`start()` connects again.

A `stop()` during an in-flight `start()` no longer leaves an adapter connected on a stopped runner.
The start disconnects what connected, wires no inbound dispatch, and resolves
`{ connected: [], failed }` instead of naming the platforms it connected. Under `"rollback"`, a
connect that fails still rejects it.

Under the default `connectFailure: "rollback"`, the rollback waits for every connect to settle, so
an adapter that connects after another refused is disconnected as well. The rejection therefore
comes only once the slowest connect settles. With one adapter refusing and another whose connect
hangs, `start()` used to reject at once and now stays pending, as a successful rollback start and
an `"isolate"` start already did.

When `stop()`, a rollback, or a start that `stop()` overtook disconnects an adapter and that
`disconnect()` fails, the runner now writes one line to stderr naming the platform, with any
credential in the error redacted. The failure used to be discarded, so an adapter that might still
hold its platform session left no trace. How `start()` and `stop()` resolve or reject is unchanged.
