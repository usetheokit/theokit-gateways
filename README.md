# theokit-gateways

Multi-channel gateway packages for the Theo ecosystem, extracted from `theokit-sdk` (2026-06-18, plan `monorepo-cohesion-split`) so the SDK stays a cohesive Agent-AI **Harness** while these platform adapters evolve on their own cadence.

## Packages

| Package | Platform | Exercised against the real platform |
| --- | --- | --- |
| `@theokit/gateway` | Transport-agnostic core (BasePlatformAdapter, SessionRouter, DeliveryRouter, GatewayRunner). | end to end, over Matrix |
| `@theokit/gateway-telegram` | Telegram (grammy) | **full** — send and receive |
| `@theokit/gateway-discord` | Discord (discord.js) | **full** — send and receive |
| `@theokit/gateway-slack` | Slack (@slack/bolt) | **full** — send and receive |
| `@theokit/gateway-matrix` | Matrix | **full** — send and receive |
| `@theokit/gateway-mattermost` | Mattermost | **full** — send and receive |
| `@theokit/gateway-email` | Email (nodemailer + imapflow) | **full** — send and receive |
| `@theokit/gateway-line` | LINE Messaging API | partial — send only; the inbound test exists and has never run |
| `@theokit/gateway-whatsapp` | WhatsApp (Meta Cloud API + whatsapp-web.js + Baileys) | partial — send accepted by Meta; delivery and inbound not asserted here |
| `@theokit/gateway-teams` | Microsoft Teams | **none** — no credentials; four tests written, never executed |
| `@theokit/gateway-sms` | SMS (Twilio / Plivo / Vonage) | **none** — no credentials; inbound not written |

### What that column means

Unit tests say the code does what we think. They cannot say the platform agrees. The
column above reports only the second question, answered by running
`integration/tests/{platform}/live.test.ts` against the real API — with real
credentials, on a real account.

**full** is the whole circle: connect with a valid credential, return `false` rather
than throw on one the platform rejects, deliver a message, split past that platform's
own size cap into parts it accepts, map a refusal into a structured error, refuse
empty text without a call, **and receive a message back** over that platform's own
inbound transport.

Measured 2026-08-29 — 52 live tests passed, 9 skipped for missing credentials, plus 9
end-to-end tests that drive the core's hooks, slash commands, drain and restart
refusal over a real Matrix connection. Reproduce with:

```bash
cp integration/.env.example integration/.env   # then fill in what you have
pnpm --filter @theokit/gateway-integration integration
```

A platform with no credentials **skips**, naming the variables it wants. It is never
reported green.

Three caveats the column is too narrow to carry, and they are the honest part:

- **WhatsApp "send" means Meta accepted it,** not that anyone received it. The test
  asserts `ok` and a returned `wamid`; delivery status (`sent` / `delivered` /
  `failed`) arrives only by webhook, and no test here reads one. Its inbound half was
  proven once by hand against a live webhook, which is evidence, but not evidence this
  suite can re-run.
- **LINE's inbound round trip is written and has never executed.** It drives LINE's own
  `setWebhookEndpoint` / `testWebhookEndpoint` and verifies the signature over the raw
  bytes; it needs `INTEGRATION_PUBLIC_URL` pointing at a reachable HTTPS endpoint.
  Written and unrun is not the same as covered.
- **Teams needs a work tenant, not a personal account.** Personal Teams
  (`teams.live.com`) has no app catalog, so a custom bot cannot be installed and the
  two outbound tests have nothing to post into. The two authentication tests need only
  an Azure app registration.

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
