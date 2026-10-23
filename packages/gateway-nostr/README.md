# @theokit/gateway-nostr

Nostr support for [`@theokit/gateway`](../gateway).

This first part of the package is the relay client the adapter is built on. It is exported so that
another Nostr-based adapter can use the same connection code.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-nostr
```

`nostr-tools` is a dependency of this package and installs with it. The sockets use Node's global
`WebSocket` (Node 22.12 or later).

## The relay client

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

- `open()` opens one socket per relay and resolves once each has opened or failed. A relay that
  fails or drops is opened again after 1000 ms, doubling up to 30000 ms; a connection that stayed up
  for 60000 ms starts the delay over at 1000 ms.
- `subscribe(filters, onEvent)` sends the filters to every relay, now and after every reconnect. It
  resolves `true` on the first `EOSE` and `false` when none arrives within `timeoutMs` (10000 ms by
  default). An event seen on several relays reaches `onEvent` once; the client remembers the last
  1000 event ids.
- `publish(event)` sends the event to every open relay and resolves `{ ok: true }` on the first
  relay that accepts it. It resolves `relay_rejected` with the relay's message when every relay
  refused, `timeout` after 30000 ms without an answer, and `disconnected` when no relay is open or
  the client was closed. It never throws.
- A relay that asks for NIP-42 authentication gets the event `signAuth` returns. Nothing is sent to
  that relay again until it accepts that event with `OK true`; then its subscriptions, and the
  events it refused with `auth-required:`, are sent again. If it refuses the event, or does not
  answer within `timeoutMs`, the events waiting on it count as refused by that relay.
- `close()` closes every socket, settles every pending publish as `disconnected` and leaves no
  timer running.

`parseNostrSecretKey` accepts an `nsec1…` key or 64 hex characters and throws `NostrKeyError` for
anything else, with no part of the value in the message.
