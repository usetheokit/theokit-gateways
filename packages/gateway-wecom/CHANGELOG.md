# @theokit/gateway-wecom

## 0.1.0

### Minor Changes

- 5980e00: Add `@theokit/gateway-wecom`, a WeCom (企业微信) self-built application adapter.

  `WeComAdapter` verifies and decrypts the callback (`handleWebhook`: SHA-1 signature, AES-256-CBC
  envelope), turns text messages into messages and replies through the application message API,
  splitting a reply over 600 characters. Requires `@theokit/gateway` 0.12.0 or later. Not yet run
  against a live corp.
