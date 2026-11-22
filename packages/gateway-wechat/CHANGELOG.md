# @theokit/gateway-wechat

## 0.3.1

### Patch Changes

- a9940a8: Compare webhook signatures and callback tokens with the core `verifyDigest` and `safeEqualString` instead of local `timingSafeEqual` copies. Raises the `@theokit/gateway` peer floor to `>=0.26.0`.
- 9fb0994: Share the adapter test cases between WeCom and WeChat. Test-only change.

## 0.3.0

### Minor Changes

- 7ef8ea2: The `wechatChannel`, `wecomChannel` and `teamsChannel` descriptors now declare `transport: "webhook"` with a `webhook.handle`, so a host mounts them with `createWebhookHandler`. WeChat and WeCom answer the server-URL check and verify the query signature, returning the adapter's status and body unchanged; Teams verifies the connector token with the client id alone and answers each refusal with its retry status. The Express listeners are unchanged.
- cb0207e: Export a `ChannelDescriptor` with env bindings: `xChannel`, `wechatChannel` and `wecomChannel`, for `createChannels` and `configFromEnv`. The `@theokit/gateway` peer range is now `>=0.22.0 <1.0.0`.

### Patch Changes

- af511db: Declare the channel descriptors' configuration fields through a small local helper; the fields are unchanged.
- cafddee: The X, WeChat and WeCom channel descriptors build their configuration fields with one shared helper instead of three copies; the descriptors are unchanged.

## 0.2.0

### Minor Changes

- 2831ca3: Report `capabilities.maxMessageChars` from the splitter limit, and `capabilities.threads` (true for Discord, Telegram and Slack).

## 0.1.1

### Patch Changes

- ec79106: Harden webhook request validation. `handleWebhook` now answers 401 to a request whose timestamp
  is more than 300 seconds from the server clock (`stale timestamp`) and to a message whose
  timestamp and nonce were already accepted with a different body (`nonce reused`).
  `verifyWeChatSignature` takes an optional `nowMs` and returns `false` for a stale timestamp. The
  README states what plain mode does and does not authenticate.

## 0.1.0

### Minor Changes

- 3efe7e7: Add `@theokit/gateway-wechat`, a WeChat (Weixin) Official Account adapter.

  `WeChatAdapter` verifies the server-URL signature (`handleWebhook`), turns text messages into
  messages and replies through the customer-service message API, splitting a reply over 600
  characters. Requires `@theokit/gateway` 0.12.0 or later. Not yet run against a live account.
