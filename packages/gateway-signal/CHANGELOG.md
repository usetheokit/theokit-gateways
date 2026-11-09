# @theokit/gateway-signal

## 0.1.0

### Minor Changes

- 7a5d09e: Add `@theokit/gateway-signal`, a Signal adapter.

  `@theokit/gateway-signal` (first release) exports `SignalAdapter`, which starts
  `signal-cli -a <account> jsonRpc` and talks to it over stdio. `connect()` returns `true` only once
  signal-cli answers, and `false` when the binary is missing, the account is not registered, or no
  answer arrives within `connectTimeoutMs`. Inbound messages with text become `SignalMessageEvent`s;
  a markdown reply is sent with Signal text styles instead of literal asterisks. The package has no
  runtime dependencies and requires `@theokit/gateway` 0.12.0 or later, the first version with the
  `signal` key. signal-cli itself, and a registered number, are the operator's to provide.

### Patch Changes

- e890905: Refuse an outbound that carries images with `attachments_unsupported`, making no platform call,
  instead of sending its text and dropping the images. The same refusal answers an outbound with
  attachments on every adapter that sends text only.
