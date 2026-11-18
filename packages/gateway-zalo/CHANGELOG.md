# @theokit/gateway-zalo

## 0.2.0

### Minor Changes

- d4f0bc5: Report `capabilities.maxMessageChars` from the splitter's limit. IRC leaves it undefined because its limit is in bytes. None of these adapters produces thread events, so `threads` stays `false`.

## 0.1.1

### Patch Changes

- bca7cfd: Raise the `@theokit/gateway` peer floor to the core version that ships the APIs this adapter imports, so npm no longer installs it next to a core it cannot load.

## 0.1.0

### Minor Changes

- 6555723: Add `@theokit/gateway-zalo`, a Zalo Official Account adapter.

  `ZaloAdapter` verifies the OA webhook signature (`handleWebhook`), turns `user_send_text` events
  into messages and replies through the OA customer-service message API, splitting a reply over 2000
  characters. Requires `@theokit/gateway` 0.12.0 or later. Not yet run against a live OA.
