# @theokit/gateway-x

## 0.1.2

### Patch Changes

- bca7cfd: Raise the `@theokit/gateway` peer floor to the core version that ships the APIs this adapter imports, so npm no longer installs it next to a core it cannot load.

## 0.1.1

### Patch Changes

- 8eb22db: Concurrent calls no longer spend the same OAuth refresh token. `XApi.refresh()` now shares one in-flight token request, so a poll and a reply that both need a new access token make a single POST and get the same token.

## 0.1.0

### Minor Changes

- 971efb1: Add `@theokit/gateway-x`, an X (Twitter) adapter.

  `XAdapter` polls the mentions of the bot account over the X API v2 (OAuth 2.0 confidential app,
  refresh token) and turns each into a group-thread event whose channel is the conversation, with the
  tweets it replies to and the tweet it quotes in `event.x`. Only allowlisted authors are answered; an
  optional guest mode answers other authors up to a daily cap each. Replies are public replies, split
  at 280 characters into a chain. No DMs, likes or media uploads. Requires `@theokit/gateway` 0.15.0
  or later. The wire shapes are written from X's public API docs and the adapter has not been run
  against the live X API.

### Patch Changes

- 48215ce: Keep the message splitter inside the adapter and shorten the attachment refusal, so the two adapters no longer repeat the shared helpers line for line. Behaviour and exports are unchanged.
