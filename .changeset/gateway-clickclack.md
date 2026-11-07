---
"@theokit/gateway-clickclack": minor
---

Add `@theokit/gateway-clickclack`, a ClickClack adapter.

`@theokit/gateway-clickclack` (first release) exports `ClickClackAdapter`, which follows a
workspace's realtime WebSocket with a bot token, turns `message.created` events into events and
posts replies to `/api/channels/{id}/messages`, splitting one over 4000 characters into messages
sent in order (`splitForClickClack` is exported). It requires `@theokit/gateway` 0.12.0 or later.
Wire shapes are written from ClickClack's public docs and not yet run against a live server.
