# `@theokit/gateway-whatsapp`

WhatsApp platform adapter for `@theokit/gateway`. Three backends behind one
`WhatsAppBackend` interface: the Meta WhatsApp Business Cloud API, a `whatsapp-web.js`
subprocess bridge, and a `baileys` socket.

Pre-1.0 contract per ADR D314 — breaking changes allowed within 0.x. (This line used to
pin a version number, and named 0.1.0 while the package shipped 0.3.2.)


## How inbound arrives

**It depends on the backend**, and the two are not alike.

`cloud` is an **HTTP webhook** the application hosts, in four steps: verify the signature, parse
the body, turn it into events with the adapter's rules applied, and deliver each one.

```ts
import {
  normalizeStatusReceipts,
  parseWebhookPayload,
  verifyWebhookSignature,
  WhatsAppAdapter,
} from "@theokit/gateway-whatsapp";

// cloud: { accessToken, phoneNumberId, appSecret }, appSecret non-empty; handleMessage: your agent's
// handler; handleReceipt: what you do with a sent / delivered / read / failed receipt.
const adapter = WhatsAppAdapter.fromCloud(cloud, { allowedSenders: process.env.WHATSAPP_ALLOWED });
adapter.onInbound(handleMessage);
// In-process only: a route served by several instances needs a shared store for this. A claim is
// kept for Meta's seven-day redelivery window and then forgotten, so the store stays bounded.
const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const claimed = new Map<string, number>(); // wamid -> when it was claimed, oldest first

/** Claim `wamid` for delivery; false when it is already claimed. */
function claim(wamid: string): boolean {
  const now = Date.now();
  for (const [id, claimedAt] of claimed) {
    if (now - claimedAt < CLAIM_WINDOW_MS) break; // every later entry is newer
    claimed.delete(id);
  }
  if (claimed.has(wamid)) return false;
  claimed.set(wamid, now);
  return true;
}

async function onWebhook(rawBody: string, signature: string | undefined): Promise<number> {
  if (!verifyWebhookSignature(rawBody, signature, cloud.appSecret)) return 401;
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return 400;
  }
  const envelope = parseWebhookPayload(json);
  if (envelope === null) return 400;
  for (const event of adapter.toDeliverableEvents(envelope)) {
    const wamid = event.whatsapp.wamid;
    // Claimed before the await, so a redelivery during a slow handler skips it.
    if (!claim(wamid)) continue; // delivered, or being delivered by an earlier request
    if ((await adapter.deliver(event)) !== "ok") {
      claimed.delete(wamid); // Meta's retry may deliver it again
      return 503;
    }
  }
  for (const receipt of normalizeStatusReceipts(envelope)) {
    if (receipt.phoneNumberId !== cloud.phoneNumberId) continue; // another number of the same app
    await handleReceipt(receipt);
  }
  return 200;
}
```

The signature check is the route's job: `toDeliverableEvents` does not do it. It needs the Meta
app secret: `fromCloud` accepts an empty `appSecret` for an adapter that only sends, but
`verifyWebhookSignature` throws `ConfigurationError` (`missing_option`) for an empty or
whitespace-only one, because anyone can compute an HMAC under an empty key. Pass the real secret
to any adapter that receives webhooks. `theokit/server/webhook`
exports `whatsapp()` and `whatsappSubscribe()` for the signature and the GET handshake. The method
applies `allowedSenders` and the group rule exactly as `onInbound` does, so a refused sender yields
no event and one line on stderr naming only the last four digits of the number. On an adapter built
with `fromCloud`, or constructed around any backend that declares a `phoneNumberId` (every
`WhatsAppCloudBackend` does), it also drops messages addressed to another `phone_number_id`: one Meta app signs
every number's webhooks with the same secret, so a shared route must not hand one number's
messages to another number's agent. For that reason `toDeliverableEvents` throws
`ConfigurationError` (`missing_phone_number_id`) on an adapter whose backend declares no
`phoneNumberId`: a backend that wraps `WhatsAppCloudBackend` by delegation must expose the field. A
route that calls `WhatsAppCloudBackend.handleWebhookPayload`
directly, with no adapter, gets the same check: the backend's inbound handler receives only
messages addressed to the backend's own `phoneNumberId`.

`parseWebhookPayload` returns `null` for a body whose shape the normalizers cannot read: an entry
with no `changes` array, a `null` entry or change, or a `messages`, `statuses` or `contacts` list
that is not a list of objects. The whole body is refused, not just its bad entries, so the route
answers it (400 in the example) instead of dropping part of a batch unseen. Any non-null envelope
is safe to hand to `toDeliverableEvents` and `normalizeStatusReceipts`: neither throws on it.
`WhatsAppCloudBackend.handleWebhookPayload` refuses such a body the same way: it answers `false`,
as it does for a signed body that is not JSON, dispatches nothing and writes one line to stderr,
so a route built on it answers non-2xx and Meta redelivers instead of losing the batch.

Answer 200 only when every event returned `ok`. `no_handler` means nothing received the message,
and `handler_threw` means your handler failed on it; a non-2xx makes Meta retry the whole envelope,
so a handler that always throws on one message sees it again on every retry. Meta also redelivers
an envelope it did not see answered in time, so a slow handler causes repeats as well, and such a
redelivery can arrive while the first request is still running. A retry repeats the events already
delivered. The route therefore claims a `wamid` before it awaits `deliver()` and skips any `wamid`
already claimed, which covers both cases; it releases the claim when delivery fails, so Meta's retry
delivers that message again. One case stays open: when a redelivery was answered 200 because it
skipped a message that was still running, and that first delivery then fails, Meta does not retry.
A handler slower than Meta's timeout should answer 200 first and hand the events to a queue.

The claim store forgets a `wamid` seven days after claiming it. Without a bound it would hold one
entry per message for as long as the process runs. Seven days is the retry period Meta's webhook
documentation gives; it was taken from there and not measured here, so check the current figure
and keep the window at least that long.

Status receipts never reach `onStatusReceipt` on this path: that handler listens to the backend,
and your route is what receives the webhook. Read them from the envelope with
`normalizeStatusReceipts`, as above, and skip any whose `phoneNumberId` is not your number: a
receipt names the recipient's phone number, so another number's receipts are another tenant's
customer data. `WhatsAppCloudBackend.handleWebhookPayload` applies the same rule before its status
handler sees a receipt.

`baileys` and `web` hold **their own socket** — there is no webhook to host, and messages reach
`onInbound` once `connect()` resolves.

## Choosing a backend

| Backend | Needs | Exercised against real WhatsApp |
| --- | --- | --- |
| `WhatsAppCloudBackend` | a Meta Business account, an access token, a phone number id | **yes** — send accepted by Meta, `wamid` returned. Delivery status arrives by webhook and is not asserted here |
| `WhatsAppBaileysBackend` | a phone to scan a QR once, then a `sessionDir` | **yes** — paired against a real account 2026-08-30 and sent through it |
| `WhatsAppWebBackend` | a phone to scan a QR **and a Chrome/Chromium binary** | reaches WhatsApp and issues a QR, given a browser (see below) |

The Cloud API is the supported path — it is the one Meta documents, the one with no
phone tethered to a session, and the only one whose send this repository asserts in a
test. The other two speak WhatsApp's client protocol, which its terms do not sanction;
choosing one is a decision about your account, not about this package.

Measured 2026-08-29: Baileys produced a pairing QR **1441 ms** after `connect()`, then
returned `false` — not a throw, and with the reason stated — when the 45 s window closed
unscanned. The web bridge reached the same point with `PUPPETEER_EXECUTABLE_PATH` set.

Measured 2026-08-30: the Baileys backend was **paired against a real WhatsApp account** and sent
through it, returning a `wamid`. Two things that cost a session each are worth carrying:

- **Pairing is QR-only.** `requestPairingCode` exists in Baileys and WhatsApp refuses the codes
  this backend asks for — three attempts, on both the 12- and 13-digit forms of a Brazilian
  number. `WhatsAppBaileysBackend`'s docblock records what is and is not established about why.
- **A `wamid` is not delivery, and this one loses messages silently.** Two sends to the same
  Brazilian line, one with the ninth digit and one without: both returned `ok: true` with a
  `wamid`, and only `553598838687` — the form without it — arrived. `5535998838687` was accepted
  and vanished. This backend does NOT normalise the Brazilian ninth digit; pass the JID form
  WhatsApp knows, which the account itself reports (WhatsApp Web stores it under `last-wid-md`).
  Tracked as a defect rather than a footnote: a send that reports success for a message nobody
  receives is the swallowed failure `rules/error-handling.md` § 5 names first.

The web bridge has still never been paired, so it has no send anyone here can prove.

### Showing the QR: `backend.pairing`

`onQr` is push — it fires when WhatsApp issues a code, at a moment the caller does not choose. A
screen is pull: it loads when someone opens it and has to ask what is true right now. So the
backend also answers:

```ts
backend.pairing
// { status: "idle" | "awaiting_scan" | "connected" | "closed", qr?: string, qrAt?: number }
```

`qr` is present only while `awaiting_scan`, and is dropped on `connected` and on `closed` —
WhatsApp reissues roughly every 20 seconds and a screen holding the previous square offers
something that cannot be scanned. `qrAt` lets a UI show the code's age rather than a stale image.

Rendering is the app's job. This package does not encode the image and will not: `qrcode` pulls a
CLI argument parser, and a consumer using only the Cloud API backend would carry it to pair
nothing. Two lines where the screen is:

```ts
import { toDataURL } from "qrcode";
const src = await toDataURL(backend.pairing.qr);
```

### The web backend needs a browser you provide

`whatsapp-web.js` drives a real Chrome through Puppeteer, and **this package does not ship
one**: the repository leaves `puppeteer` out of `pnpm.onlyBuiltDependencies`, so its
postinstall never downloads a browser. Without one the bridge starts, fails to find Chrome,
and reports that failure in its own protocol — it does not crash, which is the fix from
B-002, but it does not connect either.

Point it at a browser you already have:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome node your-app.js
```

The bridge spawns without an explicit `env`, so it inherits yours and the variable
reaches Puppeteer. `WhatsAppBaileysBackend` needs no browser at all, which is the reason
it exists (B-001).
