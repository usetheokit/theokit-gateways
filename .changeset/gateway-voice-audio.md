---
"@theokit/gateway": minor
"@theokit/gateway-telegram": minor
---

Carry voice in both directions. The inbound event gains an optional `audio` field, an
`InboundAudio` with the voice note's bytes, media type and duration in seconds, and
`OutboundAttachment` gains an `audio` member beside `image`. The Telegram adapter reads a polled
voice note through `getFile` and a download bounded at 20 MiB and 30 seconds, delivering the
message without `audio` and one stderr line when it cannot, and sends an audio attachment through
`sendVoice` with the reply text as its caption. Every other adapter refuses audio as it refuses an
image. Code that switches exhaustively on `OutboundAttachment["kind"]` gains a case.
