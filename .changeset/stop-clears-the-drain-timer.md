---
"@theokit/gateway": patch
---

**`stop()` no longer holds the process open for the whole drain window.** A bot that stopped on `SIGINT` sat there for ten more seconds before the process exited, with nothing running and nothing to wait for.

`stop()` drains in-flight handlers by racing them against a `drainTimeoutMs` timer. `Promise.race` settles on whichever branch finishes first and abandons the other — but an abandoned `setTimeout` is still a scheduled timer, and a scheduled timer keeps Node's event loop alive. The drain finished in under a millisecond; the timer it beat kept the process running for the remaining ten seconds. Measured before the fix: `stop()` returned after 0 ms, the process exited after 10 001 ms. After: 1 ms.

The delay only appeared once at least one event had been dispatched, since the drain branch is guarded on there being something in flight — which is to say, on every real bot rather than on any test that stopped a runner it had never used. Under an orchestrator that sends `SIGTERM` and then `SIGKILL`, the difference is whether shutdown is clean or forced.

The timer handle is now cleared in a `finally`, so the cleanup does not depend on which branch of the race won.
