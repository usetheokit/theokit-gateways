# @theokit/gateway-synology-chat

## 0.4.0

### Minor Changes

- ec85246: Map HTTP send failures with `sendErrorFromHttp`: 429 is now `rate_limit` with `retryAfterMs`, 401 `auth_failed`, 403 `permission_denied`, 5xx `server_error`, and a rejected fetch `network_error`. The old codes move to `platformCode`: `google_chat_auth_error`, `google_chat_http_error`, `talk_unauthorized`, `talk_bad_request`, `talk_http_error`, `synology_api_error` and `twitch_api_error` (Synology body-level errors are now `platform_error`). Raises the `@theokit/gateway` peer floor to 0.25.0.

### Patch Changes

- a9940a8: Compare webhook signatures and callback tokens with the core `verifyDigest` and `safeEqualString` instead of local `timingSafeEqual` copies. Raises the `@theokit/gateway` peer floor to `>=0.26.0`.

## 0.3.0

### Minor Changes

- be678d9: The `nextcloudTalkChannel` and `synologyChatChannel` descriptors now declare `transport: "webhook"` with a `webhook.handle`, so a host mounts them with `createWebhookHandler`. Nextcloud Talk checks the signature headers over the raw body; Synology Chat checks the outgoing-webhook token in the form body. Statuses match the packages' own routes, and the Express listeners are unchanged.

## 0.2.0

### Minor Changes

- 4107ff7: Export `synologyChatChannel`, `twitchChannel` and `zaloPersonalChannel`: `ChannelDescriptor`s with env bindings for `createChannels` and `configFromEnv`. Requires `@theokit/gateway >=0.22.0`.

## 0.1.1

### Patch Changes

- bca7cfd: Raise the `@theokit/gateway` peer floor to the core version that ships the APIs this adapter imports, so npm no longer installs it next to a core it cannot load.

## 0.1.0

### Minor Changes

- 67e0b78: Add `@theokit/gateway-synology-chat`, a Synology Chat bot adapter.

  `@theokit/gateway-synology-chat` (first release) exports `SynologyChatAdapter`, which takes a bot's
  outgoing callbacks on its own listener (or a route on your Express app), checking each callback's
  token in constant time, and replies through the bot's Incoming URL. A `post_id` already delivered is
  not delivered again, bodies are capped at 1 MiB, and the Incoming URL, which holds a token, appears
  in no error or log line. `express` is an optional peer, and `@theokit/gateway` 0.12.0 or later is
  required. Not yet run against a NAS.

### Patch Changes

- acc8f25: Refuse an outbound that carries images with `attachments_unsupported`, making no platform call,
  instead of sending its text and dropping the images. The same refusal answers an outbound with
  attachments on every adapter that sends text only.
