# @theokit/gateway-nostr

Nostr platform adapter for [`@theokit/gateway`](../gateway): it answers direct messages sent to a
bot's key, NIP-17 gift wraps and legacy NIP-04 messages, through one or more relays.

## How inbound arrives

**Outbound WebSockets to the relays.** The adapter opens one socket per relay and subscribes to
gift wraps (kind 1059) and NIP-04 messages (kind 4) addressed to the bot's public key. There is no
webhook to host.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-nostr
```

`nostr-tools` is a dependency of this package and installs with it. The sockets use Node's global
`WebSocket` (Node 22.12 or later).

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { NostrAdapter } from "@theokit/gateway-nostr";

const adapter = new NostrAdapter({
  secretKey: process.env.NOSTR_SECRET_KEY ?? "",
  relays: ["wss://relay.example"],
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

- `connect()` answers `true` on the first `EOSE` from any relay, and `false`, never a throw, when
  none arrives within 10000 ms.
- **Restarts.** A message whose own `created_at` is older than `ignoreBefore` (by default the time
  the adapter was built) is not answered, so the messages a relay replays after a restart are not
  answered twice. For NIP-17 the date compared is the rumor's: a wrap's own date is randomised up to
  two days into the past. The rumor's date is the sender's claim, so a sender who dates a message in
  the future gets it answered again after a restart; a host that needs exactly-once passes a
  persisted `ignoreBefore`.
- A message the bot's own key wrote (its own NIP-17 copy included) produces no event, and a message
  seen twice, by wrap id or rumor id, is delivered once. The adapter remembers the last 1000 ids.
- A message that does not decrypt is logged by its event id and skipped.
- **Replies.** `sendMessage` writes to `channel.id`, the recipient's public key as 64 lowercase hex.
  A sender whose last message was NIP-04 gets a NIP-04 reply; anyone else gets a NIP-17 gift wrap,
  plus a copy wrapped to the bot so its other clients see what it sent. The answer is the
  recipient's copy: `ok` with the rumor id (or the kind 4 event id), `relay_rejected` with the
  relay's message, `timeout` after 30000 ms, or `disconnected`. `markdown` loses its markers; Nostr
  direct messages are plain text.
- A relay can refuse a long reply with its own size limit, reported as `relay_rejected`; replies
  are not split.

## The relay client

`NostrRelayClient` is exported for other Nostr-based adapters.

```ts
import { NostrRelayClient, parseNostrSecretKey } from "@theokit/gateway-nostr";
import { makeAuthEvent } from "nostr-tools/nip42";
import { finalizeEvent } from "nostr-tools/pure";

const secretKey = parseNostrSecretKey(process.env.NOSTR_SECRET_KEY ?? "");
const client = new NostrRelayClient({
  relays: ["wss://relay.example"],
  signAuth: async (challenge, relay) =>
    finalizeEvent(makeAuthEvent(relay, challenge), secretKey),
});

await client.open();
await client.subscribe([{ kinds: [1], limit: 10 }], (event) => console.log(event.content));
```

- `open()` opens one socket per relay and resolves once each has opened or failed, or after
  `timeoutMs`. A relay that fails or drops is opened again after 1000 ms, doubling up to 30000 ms; a
  connection that stayed up for 60000 ms starts the delay over at 1000 ms.
- `subscribe(filters, onEvent)` sends the filters to every relay, now and after every reconnect. It
  resolves `true` on the first `EOSE` and `false` when none arrives within `timeoutMs` (10000 ms by
  default). An event seen on several relays reaches `onEvent` once.
- `publish(event)` resolves `{ ok: true }` on the first relay that accepts the event,
  `relay_rejected` when every relay refused it, `timeout` after 30000 ms, and `disconnected` when no
  relay is open. It never throws.
- A relay that asks for NIP-42 authentication gets the event `signAuth` returns. Nothing is re-sent
  to that relay until it accepts that event; then its subscriptions, and the events it refused with
  `auth-required:`, are sent again. A refusal, or no answer within `timeoutMs`, counts as that relay
  refusing every publish pending on it.
- `close()` closes every socket, settles every pending publish as `disconnected` and leaves no
  timer running.

`parseNostrSecretKey` accepts an `nsec1…` key or 64 hex characters and throws `NostrKeyError` for
anything else, with no part of the value in the message.
