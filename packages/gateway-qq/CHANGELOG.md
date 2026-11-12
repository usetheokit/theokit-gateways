# @theokit/gateway-qq

## 0.1.1

### Patch Changes

- 7ebf807: Harden the QQ webhook input checks. A webhook body that is JSON but not an object, and a callback URL validation whose `plain_token` or `event_ts` is not in the expected token or timestamp shape, are now answered with 400.

## 0.1.0

### Minor Changes

- 6178f72: Add `@theokit/gateway-qq`, a QQ Bot adapter.

  `QQAdapter` verifies the Ed25519-signed webhook (`handleWebhook`, which also answers the callback
  URL validation), turns C2C text messages into direct-message events and replies through the QQ Bot
  message API as passive replies, splitting a reply over 2000 characters. Direct messages only.
  Requires `@theokit/gateway` 0.15.0 or later. The wire shapes are written from the QQ Bot open
  platform docs and the adapter has not been run against a live QQ Bot.

### Patch Changes

- c6ee490: Restructure the QQ adapter and write the credential-shape and platform tables as rows, so they no longer repeat the same structure entry after entry. Behaviour and exports are unchanged.
- 48215ce: Keep the message splitter inside the adapter and shorten the attachment refusal, so the two adapters no longer repeat the shared helpers line for line. Behaviour and exports are unchanged.
