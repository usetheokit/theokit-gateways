---
"@theokit/gateway-x": minor
---

Add `@theokit/gateway-x`, an X (Twitter) adapter.

`XAdapter` polls the mentions of the bot account over the X API v2 (OAuth 2.0 confidential app,
refresh token) and turns each into a group-thread event whose channel is the conversation, with the
tweets it replies to and the tweet it quotes in `event.x`. Only allowlisted authors are answered; an
optional guest mode answers other authors up to a daily cap each. Replies are public replies, split
at 280 characters into a chain. No DMs, likes or media uploads. Requires `@theokit/gateway` 0.15.0
or later. The wire shapes are written from X's public API docs and the adapter has not been run
against the live X API.
