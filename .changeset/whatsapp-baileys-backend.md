---
"@theokit/gateway-whatsapp": minor
"@theokit/gateway": minor
---

**A third WhatsApp backend: `WhatsAppBaileysBackend`.** It speaks the WhatsApp Web multi-device protocol over a WebSocket. Where the `web` backend drives a headless Chromium through `whatsapp-web.js`, this holds a socket — that is the whole difference in kind.

Reach it with `WhatsAppAdapter.fromBaileys({ sessionDir })`, or through `WhatsAppAdapter.from({ backend: "baileys", baileys: { … } })` when the choice arrives as configuration rather than as a decision in code. `baileys` is an **optional peer dependency** (`>=7.0.0-rc14`), loaded lazily at connect: a consumer who never constructs this never needs it installed.

**Added rather than replacing**, for three reasons a substitution would not give. Nobody loses a paired session — a Puppeteer profile and a multi-file auth state are not interchangeable. The comparison against the incumbent becomes measurable rather than asserted, which is the whole point: no comparison has been made yet, and this changeset does not claim one. And retreat stays cheap, because nobody is forced onto it.

**Unofficial, and no amount of code changes that.** It automates a WhatsApp Web session, which Meta's terms do not sanction and which can get a number banned. Use a number created for this and nothing else, never a personal one.

Three decisions worth naming:

*Sends are serialised* — one `sendMessage` in flight per socket, including when one times out. That last clause was not true when this was first written: the queue advanced on the raced result, and a timeout does not cancel a `sendMessage`, so a timed-out send stayed on the socket while the next one started — reaching the exact hazard the serialisation exists to prevent, through the timeout meant to bound it. A review found it; there is now a test that fails if the queue goes back to advancing on the race. Honest about provenance: both peer gateways studied do this and one records that concurrent sends on a single socket can misdeliver to the wrong chat. **We have not measured that in our own code**, so it is precaution rather than a reproduction of our own bug. Kept because the cost is one promise chain and the failure it guards against is a message reaching the wrong person.

*A timed-out send reports undetermined delivery, and is never retried.* A local timeout says the acknowledgement did not arrive, not that the message did not; retrying can duplicate — the failure this repository already shipped once, in the email backend re-answering its inbox.

*A connect that fails or is superseded tears its socket down.* A timed-out connect used to leave a live socket behind: it kept feeding inbound into the handler, and the retry opened a second live session — which on an unofficial automation is ban surface, not merely a leak. The same generation counter makes `disconnect()` during an in-flight `connect()` safe; without it the late success set `connected` over a backend with no socket, and every later send was refused until the object was rebuilt.

*The backend depends on a four-member socket contract we declare*, not on Baileys' types. That is what lets every test in this backend drive a fake and run with `baileys` absent — which matters, because a backend that could only be exercised with the real library installed is a backend exercised by nothing, and that is exactly how the `web` backend reached production unable to start.

*Pairing has somewhere to go.* `printQRInTerminal` stays off — a library writing to stdout decides where a host's output goes — so the QR is handed to an `onQr` callback, defaulting to stderr. Without it a fresh session directory could only ever time out: there is no other way to pair.

**What no test here proves.** Nothing in this repository touches WhatsApp. Pairing needs a QR scan by a human and there is no WhatsApp in Docker, so protocol conformance, delivery, receipts and ban behaviour are unproven by this changeset and by every gate in this repository. A green suite means our logic does what we think — not that WhatsApp agrees.

`WhatsAppMessageEvent.whatsapp.backend` and `WhatsAppBackend.kind` gain a third member, so an exhaustive `switch` over either stops compiling until the case is handled. No call site in this repository switches on them.
