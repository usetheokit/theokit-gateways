---
"@theokit/gateway": minor
---

Make `x` a first-party platform.

`@theokit/gateway` gains the `x` key in `PlatformEventRegistry`, the `XMessageEvent` and
`XThreadTweet` types and a `channelRendering` row (`plain`, markers removed). `PlatformName` grows
by one member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add it.
