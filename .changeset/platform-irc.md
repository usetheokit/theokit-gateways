---
"@theokit/gateway": minor
---

Make `irc` a first-party platform.

`@theokit/gateway` gains the `irc` key in `PlatformEventRegistry`, the `IrcMessageEvent` type,
and a `channelRendering("irc")` row (`plain`, markers removed). `PlatformName` grows by one
member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add an `irc` entry, and a package that registered its own `irc` key through
module augmentation now collides with the first-party one (TS2717) and should drop it.
