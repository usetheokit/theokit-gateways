---
"@theokit/gateway": minor
"@theokit/gateway-discord": minor
"@theokit/gateway-email": minor
"@theokit/gateway-line": minor
"@theokit/gateway-matrix": minor
"@theokit/gateway-mattermost": minor
"@theokit/gateway-slack": minor
"@theokit/gateway-sms": minor
"@theokit/gateway-teams": minor
"@theokit/gateway-telegram": minor
"@theokit/gateway-whatsapp": minor
---

**The peer floor on `@theokit/gateway` rises with this release.** Every adapter now implements
`deliver` over `runHandler`, and neither exists in an older core — an adapter installed against one
does not build. `dep-check` caught that by building the whole workspace against the floor each
package claimed, which is the one thing a version range cannot tell you by reading it.

The floor is set in the version commit rather than here, because a range cannot name a version that
does not exist yet: raised in the workspace, the same gate then fails the other way round — every
adapter declaring a floor above the core installed beside it. That is the shape `fa70153` used when
these ranges were first written.

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
