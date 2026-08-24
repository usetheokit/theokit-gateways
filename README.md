# theokit-gateways

Multi-channel gateway packages for the Theo ecosystem, extracted from `theokit-sdk` (2026-06-18, plan `monorepo-cohesion-split`) so the SDK stays a cohesive Agent-AI **Harness** while these platform adapters evolve on their own cadence.

## Packages

| Package | Platform |
| --- | --- |
| `@theokit/gateway` | Transport-agnostic core (BasePlatformAdapter, SessionRouter, DeliveryRouter, GatewayRunner). |
| `@theokit/gateway-telegram` | Telegram (grammy) |
| `@theokit/gateway-discord` | Discord (discord.js) |
| `@theokit/gateway-slack` | Slack (@slack/bolt) |
| `@theokit/gateway-whatsapp` | WhatsApp (Meta Cloud API + whatsapp-web.js) |
| `@theokit/gateway-teams` | Microsoft Teams |
| `@theokit/gateway-email` | Email (nodemailer + imapflow) |
| `@theokit/gateway-sms` | SMS (Twilio / Plivo / Vonage) |
| `@theokit/gateway-line` | LINE Messaging API |
| `@theokit/gateway-matrix` | Matrix |
| `@theokit/gateway-mattermost` | Mattermost |

## How this fits with TheoKit

Receiving a message spans three repositories, and each owns one part of it.

| Repository | Its half |
|---|---|
| [`theokit`](https://github.com/usetheokit/theokit) | The HTTP route and the signature check. `handleChannelWebhook` validates the request, then hands your app the raw body as `payload: unknown` |
| **`theokit-gateways`** (here) | Translating that payload. `parseInbound` turns it into a canonical `MessageEvent`, so your app never re-declares a platform's wire format |
| [`theokit-sdk`](https://github.com/usetheokit/theokit-sdk) | Measured today: one redaction helper, used when logging a handler error. Whether it should do more is open — see `BACKLOG.md` B-012 |

```ts
// In a TheoKit route. The signature was already checked before this runs.
import { parseInbound } from "@theokit/gateway-telegram";

const event = parseInbound(await request.json());
if (event !== null) {
  console.log(`${event.channel.id}: ${event.text}`);
}
```

`parseInbound` returns `null` and never throws — `onMessage` runs after TheoKit has already answered
200, so there is no status left to change. Adapters whose platform uses a long-lived connection
rather than a webhook (Discord, Slack, Mattermost, Matrix, e-mail) do not go through this seam; they
own their transport, and running one alongside a TheoKit server needs a process lifecycle that does
not exist yet.

## Relationship to `@theokit/sdk`

Every adapter consumes `@theokit/sdk` as a **published npm dependency** (`^1.9.0`). `@theokit/gateway` (the core) is an in-repo workspace dependency of the adapters.

## Develop

```bash
nvm use
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm build
pnpm test
```

## History

Extracted with full git history via `git filter-repo` from `usetheo/theokit-sdk`.
