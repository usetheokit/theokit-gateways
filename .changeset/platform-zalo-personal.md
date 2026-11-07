---
"@theokit/gateway": minor
---

Make `zalo_personal` a first-party platform.

`@theokit/gateway` gains the `zalo_personal` key in `PlatformEventRegistry`, the
`ZaloPersonalMessageEvent` type and a `channelRendering` row (`plain`, markers removed).
`PlatformName` grows by one member. Code that lists every platform in a `Record<PlatformName, …>`
or in a switch with a `never` default must add it.
