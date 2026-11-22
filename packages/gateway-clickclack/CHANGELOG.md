# @theokit/gateway-clickclack

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

- 1b27d5d: Add `@theokit/gateway-clickclack`, a ClickClack adapter.

  `@theokit/gateway-clickclack` (first release) exports `ClickClackAdapter`, which follows a
  workspace's realtime WebSocket with a bot token, turns `message.created` events into events and
  posts replies to `/api/channels/{id}/messages`, splitting one over 4000 characters into messages
  sent in order (`splitForClickClack` is exported). It requires `@theokit/gateway` 0.12.0 or later.
  Wire shapes are written from ClickClack's public docs and not yet run against a live server.
