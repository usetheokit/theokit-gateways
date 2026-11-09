---
"@theokit/gateway-tlon-urbit": minor
---

Add `@theokit/gateway-tlon-urbit`, a Tlon (Urbit) adapter.

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
