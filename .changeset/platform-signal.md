---
"@theokit/gateway": minor
---

Make `signal` a first-party platform.

`@theokit/gateway` gains the `signal` key in `PlatformEventRegistry`, the `SignalMessageEvent`
type, and a `channelRendering("signal")` row (`markdown`, text unchanged). `PlatformName` grows by
one member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add a `signal` entry, and a package that registered its own `signal` key
through module augmentation now collides with the first-party one (TS2717) and should drop it.
