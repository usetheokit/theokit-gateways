---
"@theokit/gateway": minor
"@theokit/gateway-nextcloud-talk": minor
---

Add `@theokit/gateway-nextcloud-talk`, a Nextcloud Talk bot adapter, and make `nextcloud_talk` a
first-party platform.

`@theokit/gateway` gains the `nextcloud_talk` key in `PlatformEventRegistry`, the
`NextcloudTalkMessageEvent` type, and a `channelRendering("nextcloud_talk")` row (`markdown`,
passed through). `PlatformName` grows by one member. Code that lists every platform in a
`Record<PlatformName, …>` or in a switch with a `never` default must add a `nextcloud_talk`
entry, and a package that registered its own `nextcloud_talk` key through module augmentation now
collides with the first-party one (TS2717) and should drop it.

`@theokit/gateway-nextcloud-talk` (first release) exports `NextcloudTalkAdapter`, which runs as a
Talk bot. Its webhook route (default port 3000, path `/nextcloud-talk`, or the caller's own Express app
given as `app`) accepts a request only when `x-nextcloud-talk-signature` is the hex
HMAC-SHA256 of `x-nextcloud-talk-random` followed by the raw body under the bot secret, compared
in constant time, and answers 401 otherwise. A body over 1 MiB is refused with 413 and a JSON error
body before it is held. A port another listener holds makes `connect()` answer `false`. A message a person wrote becomes a
`NextcloudTalkMessageEvent`; a `Join` or a bot's message does not. `sendMessage` posts as the bot
with its own signed random, returns the `referenceId` it sent as `messageId`, and sends a text
over 32000 code points as consecutive messages. `connect()` requires the server's `bots-v1`
feature and returns `false`, never a throw, when the server cannot be read, lacks it, or passes
`connectTimeoutMs`. A `connect()` made while another is pending shares its answer, and a
`disconnect()` made while one is pending wins: the connect answers `false` and leaves no listener, and a `connect()` made after that
`disconnect()` starts a fresh session instead of inheriting the `false`.
The constructor throws on a secret outside 40 to 128 characters.
`splitForTalk` and `TALK_MAX_LENGTH` (the splitter), `talkSignature` and `verifyTalkSignature`, and
`talkBodyToMessageEvent` are exported. The package has no runtime dependencies (`express` is a
peer) and requires `@theokit/gateway` 0.12.0 or later, the first version with the
`nextcloud_talk` key.
