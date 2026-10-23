---
"@theokit/gateway": minor
---

Make `google_chat` a first-party platform.

`@theokit/gateway` gains the `google_chat` key in `PlatformEventRegistry`, the
`GoogleChatMessageEvent` type, and a `channelRendering("google_chat")` row. `PlatformName` grows by
one member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add a `google_chat` entry, and a package that registered its own `google_chat`
key through module augmentation now collides with the first-party one (TS2717) and should drop it.
