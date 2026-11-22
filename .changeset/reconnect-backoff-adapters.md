---
"@theokit/gateway-nostr": patch
"@theokit/gateway-twitch": patch
"@theokit/gateway-tlon-urbit": patch
"@theokit/gateway-buzz": minor
"@theokit/gateway-clickclack": minor
---

Reconnect with the core `ReconnectBackoff` (peer floor `@theokit/gateway` 0.26.0). nostr, twitch and tlon-urbit keep their delays. buzz and clickclack now treat `reconnectDelayMs` as the initial delay (default 2 s), double it per failed attempt up to 30 s and reset it after a socket stayed open for 60 s, instead of retrying every 2 s forever; `0` still disables reconnecting.
