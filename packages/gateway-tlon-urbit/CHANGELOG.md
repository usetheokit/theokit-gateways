# @theokit/gateway-tlon-urbit

## 0.2.2

### Patch Changes

- 998ad73: SMS declares `senderIdentity` as unauthenticated ("the caller id of a text message"). iMessage, Raft and Tlon still declare none, so apps treat them as not authenticated until a maintainer confirms each; their tests now assert that.

## 0.2.1

### Patch Changes

- f89ac5e: Reconnect with the core `ReconnectBackoff` (peer floor `@theokit/gateway` 0.26.0). nostr, twitch and tlon-urbit keep their delays. buzz and clickclack now treat `reconnectDelayMs` as the initial delay (default 2 s), double it per failed attempt up to 30 s and reset it after a socket stayed open for 60 s, instead of retrying every 2 s forever; `0` still disables reconnecting.

## 0.2.0

### Minor Changes

- 2d91e29: Ship `tlonUrbitChannel` and `smsChannel` (Twilio) `ChannelDescriptor`s with env bindings for `createChannels` and `configFromEnv`.

## 0.1.2

### Patch Changes

- bca7cfd: Raise the `@theokit/gateway` peer floor to the core version that ships the APIs this adapter imports, so npm no longer installs it next to a core it cannot load.

## 0.1.1

### Patch Changes

- bac158b: Keep the outbound checks and the inbound handler wiring in `BasePlatformAdapter`.

  `BasePlatformAdapter` gains protected `refuseUnsendable`, `outboundText`, `subscribe`, `deliverInbound`
  and `dispatchOnce`, so the `empty_text`, `not_connected` and `invalid_channel` checks, the
  markdown translation, the handler slot and the dedup-then-dispatch step exist once instead of in
  the adapters. Every adapter answers the same codes and messages as before.

## 0.1.0

### Minor Changes

- 67e0b78: Add `@theokit/gateway-tlon-urbit`, a Tlon (Urbit) adapter.

  `@theokit/gateway-tlon-urbit` (first release) exports `TlonUrbitAdapter`, which logs in to a bot
  ship with its `+code`, reads DMs from the `chat` app's `/v3` subscription over the ship's HTTP
  channel and replies with `chat-dm-action` pokes, accepting DM invites. The stream reconnects with
  backoff, replaces a channel the ship dropped, logs in again when the session expires, and stops with
  `TlonAuthError` when the code is refused. Checked against two real comets on vere 4.6 on
  2026-11-09: a DM one ship's adapter sent reached the bot's adapter, and the bot's reply came back.
  Comet names, which join their halves with `--`, are accepted, and channel actions name the ship
  without its `~`, which Eyre requires. An outbound that carries attachments is refused with
  `attachments_unsupported`, making no ship call. It depends on `@urbit/aura` and requires
  `@theokit/gateway` 0.13.0 or later, whose `SeenIds` it imports.
