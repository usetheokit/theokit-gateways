# @theokit/gateway

Multi-platform messaging gateway for `@theokit/sdk`. Transport-agnostic primitives — adapters live in separate peer-dep packages.

> **Status: 0.1.0 — pre-release.** Breaking changes allowed within the `0.x` line per semver.

## Install

```bash
pnpm add @theokit/gateway @theokit/sdk
# Plus one or more transport adapters:
pnpm add @theokit/gateway-telegram grammy
pnpm add @theokit/gateway-discord discord.js
```


## How each adapter treats `OutboundMessage.format`

**All ten honour it** — they read the field and let it decide what the platform receives. What they can DO with it differs by platform, and a consumer should not have
to read ten packages to learn which — so the classes are stated here.

| Platform | What it does with `format` |
|---|---|
| telegram | sets `parse_mode` |
| slack | sets `mrkdwn` |
| matrix | `html` only: sends `formatted_body` + `format: org.matrix.custom.html`, retrying as plain text if the homeserver refuses it. **`markdown` is dropped with a warning** — `formatted_body` promises HTML, and putting markdown there renders literal asterisks AND silently eats any `<tag>` in the text |
| teams | sets `textFormat` on the activity |
| email | sends an `html` part **alongside** `text`, never instead of it. `html` passes through verbatim (the caller owns that trust boundary); `markdown` is HTML-escaped into a `<pre>` block, so it is preserved and readable, not parsed |
| discord, mattermost | markdown is native, so `markdown` needs no flag; **`plain` escapes** `*_\`~` so a user's literal asterisks stay literal |
| line, sms, whatsapp | the platform carries no formatting on this message type — the adapter logs once that the declared format was dropped, rather than discarding it in silence |

**What none of them does is convert markdown to a platform's dialect.** `format` states the
caller's INTENT and lets the transport act on it; translating `**bold**` into WhatsApp's
`*bold*` is a presentation concern and is tracked separately.

Measured 2026-08-30: before this, two of ten read the field. An agent answered
`**Bom Sucesso (MG)**` and LINE and WhatsApp delivered literal asterisks, which is what a
declared-and-ignored field costs at the far end.


## Architecture (5 pieces)

| Module | Responsibility |
|---|---|
| `BasePlatformAdapter` | Contract every adapter implements: `connect`, `disconnect`, `sendMessage`, `onInbound` |
| `GatewayRunner` | Orchestrator: holds adapters, dispatches inbound events to your handler |
| `SessionRouter` | Pure function: `MessageEvent → agentId` (composes `Agent.resume`, ADR D174) |
| `DeliveryRouter` | Dispatch outbound messages (composes `Cron`, ADR D175) |
| `HookExecutor` | `pre_inbound` / `post_outbound` / `on_error` hooks (own contract, ADR D176) |

## Minimal example

```typescript
import { Agent } from "@theokit/sdk";
import { GatewayRunner, SessionRouter } from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";

const router = new SessionRouter();
const adapter = new TelegramAdapter({ token: process.env.TELEGRAM_BOT_TOKEN! });

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    const agent = await Agent.resume(router.resolveAgentId(event), {
      apiKey: process.env.OPENROUTER_API_KEY!,
      model: { id: "openai/gpt-4o-mini" },
    });
    const run = await agent.send(event.text);
    const result = await run.wait();
    await ctx.reply(result.result ?? "no reply");
    await agent.dispose();
  },
});

await runner.start();
```

## Receiving from a TheoKit app

Three repositories share this path. `theokit` owns the HTTP route and the signature check —
`handleChannelWebhook` verifies the signature, parses the body, and hands your app the parsed JSON
as `payload: unknown`. These packages own the translation. `theokit-sdk` is used here for one thing
today: redacting a throw before it reaches a log, at two call sites.

```ts
import { parseInbound } from "@theokit/gateway-telegram";

// Inside onMessage. The signature and the JSON parse already happened.
const event = parseInbound(message.payload);
if (event !== null) {
  console.log(`${event.platform} ${event.channel.id}: ${event.text}`);
}
```

`parseInbound` returns `null` rather than throwing for a body it does not recognise. Measured
against `theokit@0.48.14`: `onMessage` is
awaited **before** the 200 is built, and nothing inside `handleChannelWebhook` catches — so a throw
on an unparseable payload means the 200 is never built. Mounted in a TheoKit route, the rejection
reaches that route's error boundary and is answered **500**: the platform sees a failed delivery
where it expected an acknowledgement.

### WhatsApp, since `theokit@0.60.0`

Until that release this was impossible rather than undocumented: `theokit/server/webhook`
exported no `whatsapp` validator, so the `validators` map could not carry one and the path
answered 404 by construction. Meta's subscribe handshake had no seam at all
([usetheokit/theokit#556](https://github.com/usetheokit/theokit/issues/556), filed from
here). Both halves exist now, and the wiring needs three things that are easy to miss:

```ts
import { handleChannelWebhook } from "theokit/server/agent";
import { route } from "theokit/server/define";
import { whatsapp, whatsappSubscribe } from "theokit/server/webhook";
import { normalizeInboundMessages, parseWebhookPayload } from "@theokit/gateway-whatsapp";

const handle = ({ request }: { request: Request }) =>
  handleChannelWebhook(request, new URL(request.url).pathname, {
    validators: { whatsapp: whatsapp({ appSecret: process.env.META_APP_SECRET! }) },
    subscribe: { whatsapp: whatsappSubscribe({ verifyToken: process.env.META_VERIFY_TOKEN! }) },
    onMessage: async ({ payload }) => {
      const envelope = parseWebhookPayload(payload);
      if (envelope === null) return; // not a shape we know — answer normally
      for (const event of normalizeInboundMessages(envelope)) {
        console.log(`${event.from}: ${event.text}`);
      }
    },
  });

// BOTH verbs, and `.csrf(false)` on each.
export const GET = route().csrf(false).policy("public").handler(handle).build();
export const POST = route().csrf(false).policy("public").handler(handle).build();
```

- **`GET` as well as `POST`.** Meta calls the endpoint once with
  `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` and expects the challenge echoed as
  `text/plain` before it delivers anything. That is what `subscribe` answers. A `GET` on a
  platform that has a validator and no `subscribe` entry is **405**, not 404 — configured, but
  it does not do handshakes.
- **`.csrf(false)` on both.** Without it the route answers `403 CSRF_INVALID: Missing
  X-Theo-Action header` before the signature is ever checked, and Meta will never send that
  header. `policy("public")` answers a different question — may an unauthenticated caller reach
  this — and does not lift the CSRF gate. The HMAC is strictly stronger than the header it
  replaces, and Meta carries no session for a third-party page to ride.
- **`appSecret` is the Meta *app secret*,** not the access token. It accepts an array so a
  rotation can verify against either.

This package also exports `verifyWebhookSignature` and `verifyWebhookSubscription`, which do
the same two jobs. Use theokit's when you are on this seam; ours exist for an app that is not,
and they are what `gateway-sms` uses through its own `createWebhookServer`.

Not verified here: the `theokit` behaviour above was measured by the session that shipped
0.60.0, driving a scaffolded app over HTTP. What this repository checked is narrower and
stated as such — that `theokit@0.60.0` does export `whatsapp` and `whatsappSubscribe` from
`theokit/server/webhook`, that `route` lives on `theokit/server/define` rather than on the
`theokit/server` umbrella that warns it is deprecated, and that `parseWebhookPayload` takes the
`unknown` payload `onMessage` hands over. A real delivery from Meta needs an approved app and a public URL, and
has not happened on either side.

`parseInbound` under that name exists on `@theokit/gateway-telegram` and `@theokit/gateway-sms`,
with different arguments: SMS takes `(options, ctx)` because the `SignatureContext` it needs carries
the raw body, the headers and the URL, and `ChannelMessage` provides none of the three — so it is wired through its
own `createWebhookServer` rather than this seam.
Every other adapter exports its translation under its own name — `gateway-line` has
`lineEventToMessageEvent`, `gateway-whatsapp` composes `parseWebhookPayload` with
`normalizeInboundMessages` — each with its own signature: read the one you are using rather than
assuming this one's.

Adapters whose transport is a long-lived connection rather than a webhook own that transport and do
not go through this seam.

## Design principles

- **Compose, don't reimplement.** The gateway never owns session persistence (SDK does), never owns scheduling (Cron does), never owns prompt resolution (SystemPromptResolver does).
- **Adapters are peer-dep packages.** Install only the transports you need.
- **Hooks live in the gateway, not the SDK.** Transport-layer concerns shouldn't pollute the SDK's Plugin contract.

See `.claude/knowledge-base/adrs/D170-D181-*.md` for the full design rationale.

## License

Apache-2.0
