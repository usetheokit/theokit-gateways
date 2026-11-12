# @theokit/gateway-zalo-personal

## 0.1.0

### Minor Changes

- baadf93: Add `@theokit/gateway-zalo-personal`, a Zalo Personal adapter.

  `@theokit/gateway-zalo-personal` (first release) exports `ZaloPersonalAdapter`, which logs in to a
  personal Zalo account with a saved web session through the unofficial `zca-js` library (installed by
  the consumer, imported on `connect()`), turns direct and group text messages into events and sends
  replies, splitting one over 2000 characters into messages sent in order (`splitForZaloPersonal` is
  exported). It requires `@theokit/gateway` 0.12.0 or later. Not yet run against a live account.
