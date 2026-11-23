---
"@theokit/gateway": minor
"@theokit/gateway-telegram": minor
---

`InboundAudio` is read on demand: `data` is replaced by `read(): Promise<Uint8Array>` and an optional `size`. The Telegram adapter downloads a voice note on the first `read()`, so a `pre_inbound` hook that blocks the message causes no download. `withMediaUnderstanding` reads the audio only when a transcriber is configured.
