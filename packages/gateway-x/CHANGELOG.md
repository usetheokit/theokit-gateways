# @theokit/gateway-x

## 0.6.0

### Minor Changes

- d7f5803: `configFromEnv` takes `{ prefix, rename, require, enabledBy }` (a string prefix still works), and a descriptor's `create(config, deps)` receives runtime dependencies from `ChannelEntry.deps`. The X descriptor reads `credentialStore`; the WhatsApp baileys variant reads `onQr` and `connectTimeoutMs`.

## 0.5.0

### Minor Changes

- 7da088b: Send failures use the shared `SendErrorCode` values instead of `x_send_failed`, `qq_send_failed`, `zalo_send_failed` and `yuanbao_send_failed`. An HTTP failure maps by status through `sendErrorFromHttp` (429 is `rate_limit` with `retryAfterMs` from `Retry-After`, 401 is `auth_failed`, and so on); a 200 answer with a platform error code is `platform_error` with that code in `platformCode`; a rejected fetch is `network_error`. The fetch seam's response may now carry optional `headers`. The `@theokit/gateway` peer floor is now `>=0.25.0`.

### Patch Changes

- 305ddb7: Cache access tokens with the core `createTokenCache`, so concurrent sends with an empty cache make one token request. Raises the `@theokit/gateway` peer floor to `>=0.25.0`.

## 0.4.1

### Patch Changes

- 1758ec9: Replace the hand-written bounded dedup sets with `SeenIds` from `@theokit/gateway`; behavior is unchanged.

## 0.4.0

### Minor Changes

- cb0207e: Export a `ChannelDescriptor` with env bindings: `xChannel`, `wechatChannel` and `wecomChannel`, for `createChannels` and `configFromEnv`. The `@theokit/gateway` peer range is now `>=0.22.0 <1.0.0`.

### Patch Changes

- af511db: Declare the channel descriptors' configuration fields through a small local helper; the fields are unchanged.
- cafddee: The X, WeChat and WeCom channel descriptors build their configuration fields with one shared helper instead of three copies; the descriptors are unchanged.

## 0.3.0

### Minor Changes

- 4e7c21b: Add `CredentialStore` and `createFileCredentialStore` to `@theokit/gateway`, and `credentialStore` / `credentialKey` to `XAdapterOptions` so a rotated X refresh token survives a restart.

### Patch Changes

- a12e04c: Raise the `@theokit/gateway` peer floor of `@theokit/gateway-x` to 0.20.0 and bump the workspace `@theokit/gateway` version to match.

## 0.2.0

### Minor Changes

- 2831ca3: Report `capabilities.maxMessageChars` from the splitter limit, and `capabilities.threads` (true for Discord, Telegram and Slack).

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
