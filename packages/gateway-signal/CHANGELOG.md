# @theokit/gateway-signal

## 0.4.0

### Minor Changes

- 6f73151: Remove the two package-local copies of the line-framed JSON-RPC client: `gateway-signal` and `gateway-imessage` now use the one `JsonRpcLineClient` exported by `@theokit/gateway`, so a single implementation exists. Raises their `@theokit/gateway` peer floor to `>=0.27.0`, the first core release that exports it.

### Patch Changes

- 03c3a2c: Use the core `JsonRpcLineClient` instead of a local copy, and raise the `@theokit/gateway` peer floor to 0.27.0.

## 0.3.0

### Minor Changes

- d6fe699: Export `signalChannel`, `imessageChannel` and `raftChannel`: channel descriptors with an environment variable bound to each option, for `createChannels` and `configFromEnv`.

  The three packages now require `@theokit/gateway >=0.22.0` and read channel config with its shared `channelConfigReaders`.

### Patch Changes

- fc94485: The email, IRC, Matrix, Nextcloud Talk and Signal channel descriptors build their configuration fields with the shared `field` helper, and email and Matrix read their env-string numbers and booleans through one shared reader instead of two copies. The descriptors and the values they accept are unchanged.

## 0.2.0

### Minor Changes

- ad2816a: Add a `senderKey` option (`"uuid"` default, or `"number"`) to choose whether `sender.id` is the sender's UUID or phone number. An invalid value throws `GatewayConfigurationError` (`invalid_config`).

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
