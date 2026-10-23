---
"@theokit/gateway": minor
---

Make `imessage` a first-party platform.

`@theokit/gateway` gains the `imessage` key in `PlatformEventRegistry`, the `IMessageMessageEvent`
type, and a `channelRendering("imessage")` row (`plain`, markers removed). `PlatformName` grows by
one member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add an `imessage` entry, and a package that registered its own `imessage` key
through module augmentation now collides with the first-party one (TS2717) and should drop it.
