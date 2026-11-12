# @theokit/gateway-yuanbao

## 0.1.0

### Minor Changes

- d7ed3ab: Add `@theokit/gateway-yuanbao`, a Tencent Yuanbao (元宝) bot adapter.

  `YuanbaoAdapter` verifies the signed callback (`handleWebhook`: HMAC-SHA256 over timestamp and
  body), turns text messages into messages and replies through the bot message API, splitting a
  reply over 2000 characters. Requires `@theokit/gateway` 0.15.0 or later. The wire shapes are an
  assumption and the adapter has not been run against a live Yuanbao bot.
