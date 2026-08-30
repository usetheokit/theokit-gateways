---
"@theokit/gateway-line": patch
"@theokit/gateway-sms": patch
---

The webhook server can be started again after being stopped.

`started` and `stopped` were write-once. After a `stop()`, `start()` hit `if (started)` and returned
without creating a listener — so the server was silently dead: no error, no log, just a port nothing
answers on. The next `stop()` was a no-op for the same reason, in the other direction.

Anything that restarts a gateway — a config reload, a reconnect after a network fault, a supervisor
cycling the process in-band — got a server that reported success and served nothing.

Fixed in commit 11000cc on 2026-08-29; this changeset was missing, so the fix would have stayed
unreleased and npm would have gone on serving the broken code.
