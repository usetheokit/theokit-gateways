---
"@theokit/gateway-twitch": minor
---

Add `@theokit/gateway-twitch`, a Twitch chat adapter.

`@theokit/gateway-twitch` (first release) exports `TwitchAdapter`, which reads `channel.chat.message`
notifications from an EventSub WebSocket and replies with Helix Send Chat Message, splitting a reply
over 500 characters into messages sent in order (`splitForTwitch` is exported). It validates the
token's owner and scopes, keeps the session through keepalive gaps, drops and `session_reconnect`
handovers, and reports a dropped message with Twitch's reason. It does not refresh the access token.
It has no runtime dependencies and requires `@theokit/gateway` 0.12.0 or later. Not yet run against
a live channel.
