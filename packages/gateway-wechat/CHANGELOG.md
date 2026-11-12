# @theokit/gateway-wechat

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
