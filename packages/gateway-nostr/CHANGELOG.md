# @theokit/gateway-nostr

## 0.1.0

### Minor Changes

- 67e0b78: Add `@theokit/gateway-nostr`, a Nostr adapter.

  `@theokit/gateway-nostr` (first release) exports `NostrAdapter`, which answers NIP-17 gift-wrapped
  and NIP-04 direct messages sent to a bot's key through one or more relays, and `NostrRelayClient`,
  the relay pool it is built on: one WebSocket per relay, cross-relay dedupe, NIP-42 authentication,
  and reconnection from 1000 to 30000 ms. A restarted adapter does not answer messages dated before
  its `ignoreBefore` (by the rumor's date, never the wrap's). Replies go back by NIP-04 to a NIP-04
  sender and as gift wraps to anyone else. `parseNostrSecretKey` reads `nsec1` or 64 hex. It depends
  on `nostr-tools` and requires `@theokit/gateway` 0.12.0 or later. Not yet run against a live relay.

### Patch Changes

- acc8f25: Refuse an outbound that carries images with `attachments_unsupported`, making no platform call,
  instead of sending its text and dropping the images. The same refusal answers an outbound with
  attachments on every adapter that sends text only.
