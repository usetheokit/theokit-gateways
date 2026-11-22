# @theokit/gateway-wecom

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

- d4f0bc5: Report `capabilities.maxMessageChars` from the splitter's limit. IRC leaves it undefined because its limit is in bytes. None of these adapters produces thread events, so `threads` stays `false`.

## 0.1.0

### Minor Changes

- 5980e00: Add `@theokit/gateway-wecom`, a WeCom (企业微信) self-built application adapter.

  `WeComAdapter` verifies and decrypts the callback (`handleWebhook`: SHA-1 signature, AES-256-CBC
  envelope), turns text messages into messages and replies through the application message API,
  splitting a reply over 600 characters. Requires `@theokit/gateway` 0.12.0 or later. Not yet run
  against a live corp.
