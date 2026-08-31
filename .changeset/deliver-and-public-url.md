---
"@theokit/gateway": minor
"@theokit/gateway-discord": patch
"@theokit/gateway-email": patch
"@theokit/gateway-line": patch
"@theokit/gateway-matrix": patch
"@theokit/gateway-mattermost": patch
"@theokit/gateway-slack": patch
"@theokit/gateway-sms": patch
"@theokit/gateway-teams": patch
"@theokit/gateway-telegram": patch
"@theokit/gateway-whatsapp": patch
---

`deliver(event)` — every adapter can now be handed an event that arrived out of band (#83).

`onInbound` was the seam every adapter implemented and it had no public counterpart. Six platforms
self-deliver once connected — long polling, a gateway socket, Socket Mode, a sync loop, IMAP — so
the asymmetry stayed invisible: `GatewayRunner` worked for eight platforms and silently did nothing
for LINE and WhatsApp Cloud, whose payloads arrive on an HTTP route the application owns. Every app
wired those two by hand, beside the runner rather than through it.

```ts
const outcome = await adapter.deliver(event)   // "ok" | "no_handler" | "handler_threw"
```

The three outcomes are distinguished because a caller acts on them differently: answering a webhook
200 when nobody was subscribed tells the provider to stop retrying a message nothing received.

`BasePlatformAdapter.runHandler` holds the containment once, where ten copies of it used to live —
a handler is user code, its throw is named as the handler's failure rather than the platform's, and
delivery continues. Each adapter's `deliver` is one line over it.

Also: `gateway-sms`'s `createWebhookServer` now signs against the configured `publicUrl` (#90).
Twilio verifies against the URL it POSTed to, and behind a proxy that rewrites `host` — a tunnel, an
ingress, a load balancer terminating TLS — the reconstruction from headers yields the internal
address, so a correct signature fails on every delivery. `publicUrl` is required by all three
backend option shapes and documented as "used by signature verifier"; until now no source file read
it. The header reconstruction stays as the fallback for an app served directly.
