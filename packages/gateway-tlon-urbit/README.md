# @theokit/gateway-tlon-urbit

Tlon (Urbit) platform adapter for [`@theokit/gateway`](../gateway): it answers direct messages sent
to a bot ship, through the ship's own HTTP interface.

## How inbound arrives

**An event stream the adapter opens.** The adapter logs in to the ship with its `+code`, opens an
Eyre channel subscribed to the `chat` app at `/v3`, and reads the channel's `text/event-stream`.
There is no webhook to host.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-tlon-urbit
```

`@urbit/aura` (date and id encoding) is a dependency and installs with it. No Urbit client library
is used: the channel protocol is spoken over `fetch`.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { TlonUrbitAdapter } from "@theokit/gateway-tlon-urbit";

const adapter = new TlonUrbitAdapter({
  shipUrl: "https://sampel-palnet.tlon.network",
  ship: "~sampel-palnet",
  code: process.env.TLON_CODE ?? "",
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`);
  },
});
await runner.start();
```

## What the adapter does

- `connect()` posts the code to `/~/login`, opens a fresh channel, subscribes to `chat` `/v3` and
  answers `true` on the subscription's ack. It answers `false`, never a throw, when the login is
  refused or nothing answers within `connectTimeoutMs` (10000 ms).
- Each DM essay from another ship becomes one `TlonUrbitMessageEvent` whose `channel.id` is that
  ship. The bot's own essays produce no event; `ship` may be given with or without its `~`. The
  text is the essay's plain inline strings, one line per verse; styled inlines are skipped.
- Every frame read is acknowledged with its event id. When the stream ends, the adapter reads the
  channel again after 1000 ms, doubling up to 30000 ms (back to 1000 ms after a stream that stayed
  up 60000 ms); the ship resends what was not acknowledged, and the last 1000 message ids make
  sure none is answered twice. A channel the ship deleted (404) is replaced by a new one, and an
  expired session (401 or 403) logs in again; a refused re-login stops the adapter, logged as
  `TlonAuthError`.
- A DM invite is accepted with a `chat-dm-rsvp` poke.
- `sendMessage` pokes `chat` with `chat-dm-action`. The answer is the poke's own ack: `ok` with the
  message id (`<ship>/<@ud>`), `tlon_poke_failed` on an error ack, `timeout` after 30000 ms.
  `markdown` loses its markers; Tlon's inline styles are not mapped yet.

## Known limits

- The wire shapes are read from OpenClaw's Tlon extension (`abd280635b`), not observed against a
  ship; they live in `src/wire.ts` so a live run can correct them in one place.
- Group DMs (clubs) produce no event: a club essay's author is whatever the sending ship wrote, so
  it is not an identity the adapter can stand behind. An essay with no plain text is skipped too.
- A stream that stays open but goes silent is not detected; only its end or an error reconnects.
- `disconnect()` does not delete the channel on the ship; the ship removes idle channels itself.
