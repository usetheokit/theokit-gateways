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
| [`theokit`](https://github.com/usetheokit/theokit) | The HTTP route and the signature check. `handleChannelWebhook` verifies the signature, parses the body, and hands your app the parsed JSON as `payload: unknown` |
| **`theokit-gateways`** (here) | Translating that payload. `parseInbound` turns it into a canonical `MessageEvent`, so your app never re-declares a platform's wire format |
| [`theokit-sdk`](https://github.com/usetheokit/theokit-sdk) | Measured today: one redaction helper, called at two sites when logging a throw. Whether it should do more is open — see `BACKLOG.md` B-012 |

```ts
// Inside handleChannelWebhook's onMessage. The signature and the JSON parse already happened.
import { parseInbound } from "@theokit/gateway-telegram";

const event = parseInbound(message.payload);
if (event !== null) {
  console.log(`${event.channel.id}: ${event.text}`);
}
```

`parseInbound` returns `null` rather than throwing for a body it does not recognise (in
`gateway-sms` an unsupported provider in the options still throws — that is configuration, not a
body). Measured against `theokit@0.48.14`: your `onMessage`
is awaited **before** the 200 is built, and nothing inside `handleChannelWebhook` catches — so a
throw on an unparseable payload means the 200 is never built. Mounted in a TheoKit route, the
rejection reaches that route's error boundary and is answered **500**: the platform sees a failed
delivery where it expected an acknowledgement. Mounted anywhere else, whatever answers is your
framework's. Returning `null` lets an app ignore a
message it cannot read and still answer normally.

The example above is Telegram's. `@theokit/gateway-sms` also exports a `parseInbound`, and it takes
different arguments — `parseInbound(options, ctx)` — because its signature check needs the raw body,
the headers and the URL, and `ChannelMessage` carries none of the three. So SMS is wired through its
own `createWebhookServer` instead of this seam. Every other adapter exports its translation under its own name —
`lineEventToMessageEvent`, `normalizeTeamsActivity`, and `parseWebhookPayload` composed with
`normalizeInboundMessages` for WhatsApp Cloud — each with its own signature. Read the one you are
using rather than assuming this one's. Adapters whose transport is a long-lived connection (Discord, Slack, Mattermost, Matrix,
e-mail, and WhatsApp's `web` and `baileys` backends) do not go through this seam at all; they own
their transport, and running one alongside a TheoKit server needs a process lifecycle that does not
exist yet.

## Relationship to `@theokit/sdk`

Only `@theokit/gateway` (the core) declares a peer on `@theokit/sdk`, at `>=2.18.0 <5`, and uses it
for one thing: redacting a throw before it reaches a log, at two call sites. The ten adapters name it
only as a `devDependency` and mark it external at build time; none of them imports it, which is what
B-007 measured before removing the peer each had inherited. So installing an adapter does not pull
the SDK. `@theokit/gateway` is an in-repo workspace dependency of the adapters.

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
