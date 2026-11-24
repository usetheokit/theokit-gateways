# @theokit/gateway-imessage

## 0.3.1

### Patch Changes

- 998ad73: SMS declares `senderIdentity` as unauthenticated ("the caller id of a text message"). iMessage, Raft and Tlon still declare none, so apps treat them as not authenticated until a maintainer confirms each; their tests now assert that.

## 0.3.0

### Minor Changes

- 6f73151: Remove the two package-local copies of the line-framed JSON-RPC client: `gateway-signal` and `gateway-imessage` now use the one `JsonRpcLineClient` exported by `@theokit/gateway`, so a single implementation exists. Raises their `@theokit/gateway` peer floor to `>=0.27.0`, the first core release that exports it.

### Patch Changes

- 03c3a2c: Use the core `JsonRpcLineClient` instead of a local copy, and raise the `@theokit/gateway` peer floor to 0.27.0.

## 0.2.0

### Minor Changes

- d6fe699: Export `signalChannel`, `imessageChannel` and `raftChannel`: channel descriptors with an environment variable bound to each option, for `createChannels` and `configFromEnv`.

  The three packages now require `@theokit/gateway >=0.22.0` and read channel config with its shared `channelConfigReaders`.

## 0.1.1

### Patch Changes

- da49965: A stdout line from `imsg` that parses to `null` (or any other non-object) no longer crashes the host process. The line is skipped and the client stays open.

## 0.1.0

### Minor Changes

- b01e1c0: Add `@theokit/gateway-imessage`, an iMessage adapter.

  `@theokit/gateway-imessage` (first release) exports `IMessageAdapter`, which starts `imsg rpc` and
  talks to it over stdio. `connect()` returns `true` only once `imsg` accepts `watch.subscribe`, and
  `false` when the binary is missing, `imsg` refuses, or no answer arrives within
  `connectTimeoutMs`. Messages the signed-in account sent, the adapter's own replies included, never
  reach the handler. When `imsg` exits and the adapter reconnects, it resumes after the last row its
  handler finished; that cursor lives in memory and does not survive a new adapter instance or
  process. `channel.id` is `imsg`'s numeric chat id, and anything else is refused with
  `invalid_chat_id`. Send errors keep `imsg`'s meaning and are never retried:
  `imsg_outcome_uncertain` (the message may have been sent), `imsg_not_sent` (safe to retry),
  `imsg_send_lane_blocked` (the adapter ends the child; connect again) and `imsg_error` for the
  rest. The package has no runtime dependencies
  and requires `@theokit/gateway` 0.12.0 or later, the first version with the `imessage` key. `imsg`
  on a Mac signed in to Messages is the operator's to provide.

### Patch Changes

- e890905: Refuse an outbound that carries images with `attachments_unsupported`, making no platform call,
  instead of sending its text and dropping the images. The same refusal answers an outbound with
  attachments on every adapter that sends text only.
