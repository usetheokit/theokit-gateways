---
"@theokit/gateway": patch
"@theokit/gateway-feishu-lark": patch
"@theokit/gateway-nostr": patch
"@theokit/gateway-raft": patch
"@theokit/gateway-tlon-urbit": patch
"@theokit/gateway-twitch": patch
"@theokit/gateway-yuanbao": patch
"@theokit/gateway-zalo": patch
---

Keep the outbound checks and the inbound handler wiring in `BasePlatformAdapter`.

`BasePlatformAdapter` gains protected `refuseUnsendable`, `textFor`, `subscribe`, `deliverInbound`
and `dispatchOnce`, so the `empty_text`, `not_connected` and `invalid_channel` checks, the
markdown translation, the handler slot and the dedup-then-dispatch step exist once instead of in
eight adapters. Every adapter answers the same codes and messages as before.
