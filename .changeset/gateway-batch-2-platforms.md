---
"@theokit/gateway": minor
---

Make `nostr`, `feishu_lark`, `synology_chat`, `tlon_urbit` and `twitch` first-party platforms.

`@theokit/gateway` gains the five keys in `PlatformEventRegistry`, the `NostrMessageEvent`,
`FeishuLarkMessageEvent`, `SynologyChatMessageEvent`, `TlonUrbitMessageEvent` and
`TwitchMessageEvent` types, and a `channelRendering` row for each (`plain`, markers removed).
`PlatformName` grows by five members. Code that lists every platform in a
`Record<PlatformName, …>` or in a switch with a `never` default must add the five, and a package
that registered one of these keys through module augmentation now collides with the first-party
one (TS2717) and should drop it. The ten event types added since 0.11.0 are now declared in one
module beside the registry; every name is still exported from the package entry as before.
