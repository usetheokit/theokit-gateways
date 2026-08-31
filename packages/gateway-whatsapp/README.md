# `@theokit/gateway-whatsapp`

WhatsApp platform adapter for `@theokit/gateway`. Three backends behind one
`WhatsAppBackend` interface: the Meta WhatsApp Business Cloud API, a `whatsapp-web.js`
subprocess bridge, and a `baileys` socket.

Pre-1.0 contract per ADR D314 — breaking changes allowed within 0.x. (This line used to
pin a version number, and named 0.1.0 while the package shipped 0.3.2.)


## How inbound arrives

**It depends on the backend**, and the two are not alike.

`cloud` is an **HTTP webhook** the application must authenticate: Meta signs with
`X-Hub-Signature-256` over the raw body, and `theokit/server/webhook` exports `whatsapp()` and
`whatsappSubscribe()` for the signature and the GET handshake. Parsed events go to
`adapter.deliver(event)`.

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
