---
"@theokit/gateway": minor
"@theokit/gateway-whatsapp": minor
---

WhatsApp: send to the address that routes, and answer where the message came from (#82, #84).

**A send that WhatsApp discards no longer reports success.** Baileys hands back a
locally-generated `wamid` whether or not the JID routes anywhere, and the backend treated that id
as proof of delivery — so a message nobody received was recorded as a success by the caller's log,
its metrics and its retry logic. Measured on a real account: `5535998838687` and `553598838687` are
the same Brazilian line, both answered `ok: true`, and only the second arrived.

`send` now asks WhatsApp which form it routes to before sending, and refuses a number the server
does not know with `undeliverable` naming the number. That fixes the Brazilian ninth digit without a
Brazil-specific rule anywhere in this package — the answer is whatever the server says, for any
country. The lookup is cached for the life of the session, so it costs one round-trip per recipient.

**An inbound event now carries the address it arrived on**, as `whatsapp.channelJid`. `channel.id`
is normalised to digits — which is what an allowlist compares — and that normalisation strips the
domain, the part that says whether an address is a phone, a group, or an account's linked identity.
A note-to-self arrives addressed by LID, so replying to `channel.id` rebuilt `…@s.whatsapp.net`, an
address that does not exist.

**`send` accepts a qualified JID verbatim.** A `to` containing `@` is already an address and is
passed through untouched, where it used to become `231116569108705@lid@s.whatsapp.net`. So
answering an inbound event is now:

```ts
await adapter.sendMessage({ channel: { id: event.whatsapp.channelJid ?? event.channel.id, type: "dm" }, text })
```

Not affected: the Cloud backend. Meta rejects an unroutable recipient with an error code, so the
same mistake surfaces there instead of vanishing.
