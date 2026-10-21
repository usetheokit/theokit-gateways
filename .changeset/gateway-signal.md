---
"@theokit/gateway": minor
"@theokit/gateway-signal": minor
---

Add `@theokit/gateway-signal`, a Signal adapter, and make `signal` a first-party platform.

`@theokit/gateway` gains the `signal` key in `PlatformEventRegistry`, the `SignalMessageEvent`
type, and a `channelRendering("signal")` row (`markdown`, text unchanged). `PlatformName` grows by
one member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add a `signal` entry, and a package that registered its own `signal` key
through module augmentation now collides with the first-party one (TS2717) and should drop it.

`@theokit/gateway-signal` (first release) exports `SignalAdapter`, which starts
`signal-cli -a <account> jsonRpc` and talks to it over stdio. `connect()` returns `true` only once
signal-cli answers, and `false` when the binary is missing, the account is not registered, or no
answer arrives within `connectTimeoutMs`. Inbound messages with text become `SignalMessageEvent`s;
a markdown reply is sent with Signal text styles instead of literal asterisks. The package has no
runtime dependencies and requires `@theokit/gateway` 0.12.0 or later, the first version with the
`signal` key. signal-cli itself, and a registered number, are the operator's to provide.
