---
"@theokit/gateway": patch
---

`listenerLifecycle(...).start()` rejects with the bind error when the port is taken, instead of
resolving over no listener. Under Express 5 the error reached the `listen` callback, which ignored
it, so a second server on a port another one held reported itself started and answered nothing;
under Express 4 the error was emitted on the server with no listener attached. The
`createWebhookServer` of `@theokit/gateway-line` and `@theokit/gateway-sms` returns this lifecycle,
so their `start()` now rejects with `EADDRINUSE` in that case, and a later `start()` tries again.
`ListenableApp.listen` declares the error argument Express 5 passes, and `ListenerLike` the
optional `once("error")` Express 4's server has.
