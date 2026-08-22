---
"@theokit/gateway": minor
---

**`GatewayRunner.stop()` is now terminal, and says so instead of leaving a runner nothing can stop.**

`start()` and `stop()` were each written to be idempotent, but they guarded on different flags. `stop()` cleared `connected` and set `stopped`; nothing ever cleared `stopped`. So a second `start()` sailed past its `connected` guard, reconnected every adapter and rewired inbound dispatch — while the next `stop()` returned at its own `stopped` guard without disconnecting anything. Measured on the previous release: two connects, one disconnect, and a live inbound handler that no call could take down.

Nothing reported this. The adapters stayed connected, the events kept arriving, and both methods returned normally. A process that reloads configuration or reconnects after a network failure by restarting the runner leaked a connection every cycle.

`start()` on a stopped runner now throws `GatewayLifecycleError` with `code: "runner_stopped"`, and the message says to construct a new runner. That is the whole of the behaviour change: a call that previously appeared to succeed while corrupting state now fails at the call that cannot be honoured, which is the only point where a caller can still do something about it.

Adds `GatewayLifecycleError` and `GatewayLifecycleErrorOptions` to the public API. It is deliberately separate from `GatewayConfigurationError`: that one reports a bad setting, this one reports a fine setting used at an impossible moment.
