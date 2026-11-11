---
"@theokit/gateway": patch
"@theokit/gateway-tlon-urbit": patch
---

Keep the outbound checks and the inbound handler wiring in `BasePlatformAdapter`.

`BasePlatformAdapter` gains protected `refuseUnsendable`, `outboundText`, `subscribe`, `deliverInbound`
and `dispatchOnce`, so the `empty_text`, `not_connected` and `invalid_channel` checks, the
markdown translation, the handler slot and the dedup-then-dispatch step exist once instead of in
the adapters. Every adapter answers the same codes and messages as before.
