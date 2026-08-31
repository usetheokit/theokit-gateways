---
"@theokit/gateway": minor
"@theokit/gateway-line": patch
"@theokit/gateway-sms": patch
---

The half of an Express webhook server that is the same everywhere now lives in one place (#89).

`gateway-line` and `gateway-sms` each shipped one and shared 101 of ~170 lines: the lazy `express`
load, the raw-body capture with the hang it documents, and the start/stop lifecycle. What differs —
signature verification, body parsing, routing — stayed where it belongs.

It had already been paid for. A write-once latch made `start()` after `stop()` return without
creating a listener, which is a port nothing answers on with no error and no log, and the fix had to
be applied to both files by one commit because the latch lived in the copied half.

`@theokit/gateway` now exports `loadPeer`, `rawBodyCapture` and `listenerLifecycle`. **This does not
make express a dependency of the core**: nothing in that module imports it. Every shape is
structural — a request is whatever has `readableEnded` and `on`, a listener is whatever has `listen`
and `close` — so the two packages that use express keep declaring it and the core never learns the
name.

Every adapter README now states how inbound reaches it (#91): a webhook the application must
authenticate, a WebSocket, a sync loop, or an SDK that owns its own HTTP server. The three that have
no webhook say so with the reason, because an absence that is a decision should not read as a gap.
