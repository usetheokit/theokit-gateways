---
"@theokit/gateway": minor
---

Make `nextcloud_talk` a first-party platform.

`@theokit/gateway` gains the `nextcloud_talk` key in `PlatformEventRegistry`, the
`NextcloudTalkMessageEvent` type, and a `channelRendering("nextcloud_talk")` row (`markdown`,
passed through). `PlatformName` grows by one member. Code that lists every platform in a
`Record<PlatformName, …>` or in a switch with a `never` default must add a `nextcloud_talk`
entry, and a package that registered its own `nextcloud_talk` key through module augmentation now
collides with the first-party one (TS2717) and should drop it.
