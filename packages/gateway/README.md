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

`parseInbound` under that name exists on `@theokit/gateway-telegram` and `@theokit/gateway-sms`,
with different arguments: SMS takes `(options, ctx)` because its signature check needs the raw body,
the headers and the URL, and `ChannelMessage` carries none of the three — so it is wired through its
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
