# `@theokit/gateway-whatsapp`

WhatsApp platform adapter for `@theokit/gateway`. Three backends behind one
`WhatsAppBackend` interface: the Meta WhatsApp Business Cloud API, a `whatsapp-web.js`
subprocess bridge, and a `baileys` socket.

Pre-1.0 contract per ADR D314 — breaking changes allowed within 0.x. (This line used to
pin a version number, and named 0.1.0 while the package shipped 0.3.2.)

## Choosing a backend

| Backend | Needs | Exercised against real WhatsApp |
| --- | --- | --- |
| `WhatsAppCloudBackend` | a Meta Business account, an access token, a phone number id | **yes** — send accepted by Meta, `wamid` returned. Delivery status arrives by webhook and is not asserted here |
| `WhatsAppBaileysBackend` | a phone to scan a QR once, then a `sessionDir` | reaches WhatsApp and issues a QR; pairing needs the scan |
| `WhatsAppWebBackend` | a phone to scan a QR **and a Chrome/Chromium binary** | reaches WhatsApp and issues a QR, given a browser (see below) |

The Cloud API is the supported path — it is the one Meta documents, the one with no
phone tethered to a session, and the only one whose send this repository asserts in a
test. The other two speak WhatsApp's client protocol, which its terms do not sanction;
choosing one is a decision about your account, not about this package.

Measured 2026-08-29: Baileys produced a pairing QR **1441 ms** after `connect()`, then
returned `false` — not a throw, and with the reason stated — when the 45 s window closed
unscanned. The web bridge reached the same point with `PUPPETEER_EXECUTABLE_PATH` set.
Neither has been paired end to end here, so neither has a send this suite can prove.

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

