# @theokit/gateway-buzz

## 0.4.0

### Minor Changes

- f89ac5e: Reconnect with the core `ReconnectBackoff` (peer floor `@theokit/gateway` 0.26.0). nostr, twitch and tlon-urbit keep their delays. buzz and clickclack now treat `reconnectDelayMs` as the initial delay (default 2 s), double it per failed attempt up to 30 s and reset it after a socket stayed open for 60 s, instead of retrying every 2 s forever; `0` still disables reconnecting.

### Patch Changes

- d35511c: Share the adapter test cases between ClickClack and Buzz; no change to the published code.

## 0.3.1

### Patch Changes

- 1758ec9: Replace the hand-written bounded dedup sets with `SeenIds` from `@theokit/gateway`; behavior is unchanged.

## 0.3.0

### Minor Changes

- 60fb3ae: Export `buzzChannel`, `clickclackChannel` and `feishuLarkChannel`: channel descriptors with env bindings for `createChannels` and `configFromEnv`.

## 0.2.0

### Minor Changes

- d4f0bc5: Report `capabilities.maxMessageChars` from the splitter's limit. IRC leaves it undefined because its limit is in bytes. None of these adapters produces thread events, so `threads` stays `false`.

## 0.1.1

### Patch Changes

- bca7cfd: Raise the `@theokit/gateway` peer floor to the core version that ships the APIs this adapter imports, so npm no longer installs it next to a core it cannot load.

## 0.1.0

### Minor Changes

- 48b1b04: Add `@theokit/gateway-buzz`, a Buzz adapter.

  `@theokit/gateway-buzz` (first release) exports `BuzzAdapter`, which follows a
  workspace's realtime WebSocket with a bot token, turns `message.created` events into events and
  posts replies to `/api/channels/{id}/messages`, splitting one over 4000 characters into messages
  sent in order (`splitForBuzz` is exported). It requires `@theokit/gateway` 0.12.0 or later.
  Wire shapes are an assumption (no Buzz spec was available) and not yet run against a live server.
