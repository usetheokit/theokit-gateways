# @theokit/gateway-yuanbao

## 0.5.0

### Minor Changes

- 7da088b: Send failures use the shared `SendErrorCode` values instead of `x_send_failed`, `qq_send_failed`, `zalo_send_failed` and `yuanbao_send_failed`. An HTTP failure maps by status through `sendErrorFromHttp` (429 is `rate_limit` with `retryAfterMs` from `Retry-After`, 401 is `auth_failed`, and so on); a 200 answer with a platform error code is `platform_error` with that code in `platformCode`; a rejected fetch is `network_error`. The fetch seam's response may now carry optional `headers`. The `@theokit/gateway` peer floor is now `>=0.25.0`.

### Patch Changes

- 305ddb7: Cache access tokens with the core `createTokenCache`, so concurrent sends with an empty cache make one token request. Raises the `@theokit/gateway` peer floor to `>=0.25.0`.
- bdf81aa: Verify webhook signatures with the core `verifyHmac`, and compare the WhatsApp verify token with `safeEqualString`; an empty expected verify token now never matches. Raises the `@theokit/gateway` peer floor to 0.26.0.
- e517dc8: Share the HTTP failure handling (non-2xx answers, rejected fetches, send-error mapping) in one internal module instead of three copies. No behaviour change.
- 6331c13: Share the concurrent token-request test between the adapters. Test-only change.

## 0.4.0

### Minor Changes

- a0b59f4: Answer webhooks through the Fetch webhook contract: each descriptor declares `methods: ["POST"]` and a `handle`, so `createWebhookHandler` serves the route. `googleChatChannel` is now a `webhook` transport that builds its adapter with `webhook: "external"`.

## 0.3.0

### Minor Changes

- 87ce9f8: `yuanbaoChannel`, `qqChannel` and `zaloChannel` bind their config fields to environment variables for `configFromEnv`, validate values with the package `ConfigurationError` (`invalid_config`), and expose optional endpoint overrides. Peer range on `@theokit/gateway` is now `>=0.20.0`. The Zalo access token variable is `ZALO_ACCESS_TOKEN`.

### Patch Changes

- 58829a4: Export `yuanbaoChannel`, `qqChannel` and `zaloChannel`: webhook channel descriptors whose `verify` and `ingest` check the signed request and dispatch the event, so `createWebhookHandler` serves them over Fetch. `qqChannel` also answers the callback URL validation.

## 0.2.0

### Minor Changes

- d4f0bc5: Report `capabilities.maxMessageChars` from the splitter's limit. IRC leaves it undefined because its limit is in bytes. None of these adapters produces thread events, so `threads` stays `false`.

## 0.1.1

### Patch Changes

- cf4d875: `handleWebhook` answers 400 to a signed body that is valid JSON but not an object (`null`, a number, a string, an array, a boolean) instead of throwing.

## 0.1.0

### Minor Changes

- d7ed3ab: Add `@theokit/gateway-yuanbao`, a Tencent Yuanbao (元宝) bot adapter.

  `YuanbaoAdapter` verifies the signed callback (`handleWebhook`: HMAC-SHA256 over timestamp and
  body), turns text messages into messages and replies through the bot message API, splitting a
  reply over 2000 characters. Requires `@theokit/gateway` 0.15.0 or later. The wire shapes are an
  assumption and the adapter has not been run against a live Yuanbao bot.
