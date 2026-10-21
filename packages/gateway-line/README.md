# @theokit/gateway-line

LINE Messaging API platform adapter for [`@theokit/gateway`](../gateway).

APAC consumer dominant — Japan (~85M MAU), Taiwan, Thailand. Webhook-only inbound (LINE doesn't offer a WebSocket gateway). HMAC-SHA256 signature validation on every POST.


## How inbound arrives

**HTTP webhook**, and the application must authenticate it: LINE signs every POST with
HMAC-SHA256 over the raw body, and `verifyLineSignature(channelSecret, rawBody, signature)` is
exported for that.

Two ways to serve it. `createWebhookServer` mounts an Express route for you; or host the route
yourself and hand the parsed events to `adapter.deliver(event)`, which is what makes `GatewayRunner`
work for a webhook platform.

A validator in the shape `theokit/server/webhook` expects does not ship yet — see
[usetheokit/theokit#590](https://github.com/usetheokit/theokit/issues/590).
## Install

```bash
pnpm add @theokit/sdk @theokit/gateway @theokit/gateway-line
pnpm add @line/bot-sdk express
```

## Quick start

```ts
import { Agent } from "@theokit/sdk";
import { GatewayRunner } from "@theokit/gateway";
import { LineAdapter, createWebhookServer } from "@theokit/gateway-line";

const adapter = new LineAdapter({
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  // botUserId optional — used for mentionee-based mention guard (D409).
  // requireMention: true,  // default
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "line") return;
    await ctx.reply(`Echo: ${event.text}`);
  },
});

await runner.start();
const server = await createWebhookServer({ adapter, port: 3000 });
await server.start();
```

### LINE Developers Console

1. Sign in at [developers.line.biz/console](https://developers.line.biz/console).
2. Create a Provider, then a Messaging API channel.
3. Copy **Channel secret** → `LINE_CHANNEL_SECRET`.
4. Issue a **Channel access token** (long-lived) → `LINE_CHANNEL_ACCESS_TOKEN`.
5. Webhook URL: `https://${PUBLIC_URL}/line` — paste the public URL.
6. Enable "Use webhook". Disable "Auto-reply messages" + "Greeting messages" (otherwise LINE replies first).
7. Optional: configure bot username and add the bot as a friend (LINE Officlal Account Manager) — required for DMs to flow.

For local dev: `ngrok http 3000` and use the https URL.

## Channel descriptor

`lineChannel` describes this channel as data, for `createChannels` in `@theokit/gateway`: a
`webhook` channel whose config has a required, secret `channelSecret` and `channelAccessToken`
and an optional `botUserId` and `requireMention`. Its `webhook` part is how an app with its own
HTTP route verifies and ingests a request, in process:

```ts
import { createChannels, GatewayRunner } from "@theokit/gateway";
import { LineAdapter, lineChannel } from "@theokit/gateway-line";

const { adapters, rejected } = createChannels([
  {
    descriptor: lineChannel,
    config: {
      channelSecret: process.env.LINE_CHANNEL_SECRET,
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    },
  },
]);
const [line] = adapters;
if (!(line instanceof LineAdapter)) throw new Error(`LINE refused: ${rejected[0]?.error.message}`);

// Ingest dispatches to the handler the runner subscribes, and a reply needs a connected adapter.
const runner = new GatewayRunner({
  adapters,
  handler: async (event, ctx) => {
    await ctx.reply(`Echo: ${event.text}`);
  },
});
await runner.start();

// Inside your route, with the raw body as text and the request headers:
async function onLineWebhook(rawBody: string, headers: Record<string, string | undefined>) {
  if (!lineChannel.webhook.verify(line, { rawBody, headers })) return 401;
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return 400;
  }
  const outcome = await lineChannel.webhook.ingest(line, payload);
  if (outcome === "delivered") return 200;
  return outcome === "no_handler" ? 503 : 400;
}
```

- `webhook.verify` reads the `x-line-signature` header in any case and checks it against the raw
  body with the adapter's channel secret.
- `webhook.ingest` answers `"malformed"` for a payload with no `events` array, or with an event
  that is not an object, and dispatches nothing. Otherwise it dispatches through
  `dispatchWebhookBody`, which caches each event's reply token, so the handler's `ctx.reply` uses
  the reply API. A follow or other non-text event is skipped and still answers `"delivered"`, and
  so does an empty `events` array (the console's webhook verification).
- `webhook.ingest` answers `"no_handler"`, and dispatches nothing, when the payload holds a text
  message for the handler and no handler is subscribed: before `runner.start()` resolves, after
  `runner.stop()`, or when LINE's connect failed under `connectFailure: "isolate"`. Do not answer
  it with 200: LINE redelivers only a request that was not acknowledged, and only when webhook
  redelivery is turned on for the channel. `createWebhookServer` answers 200 before it dispatches,
  so it acknowledges such a request; route through `lineChannel.webhook` when that matters.
- `lineChannel.create` refuses a field of the wrong type with `ConfigurationError` coded
  `invalid_config`, the key in `detail`; the adapter still refuses an empty secret or token.

## Reply token vs Push (D407)

LINE distinguishes two outbound APIs:

- **Reply API** (free, unlimited): use within 1 minute of the inbound event. Requires the one-shot `replyToken` that came with the event.
- **Push API** (free up to 500/month then $$$): use any time, by `userId`.

The adapter handles this automatically:

1. Inbound event has `event.line.replyToken` → cached `(userId → token, 60s TTL)`.
2. First outbound to that user consumes the token (Reply API).
3. Subsequent outbound to that user (token expired) auto-falls-back to Push API (warn stderr).

Cap: 1000 entries (LRU eviction).

## Mention guard (D409)

LINE mentions are out-of-band — not inline `@text`. The webhook delivers them as `event.message.mentionees: [{ index, length, userId }]`. Adapter normalizes to `event.line.mentionees: string[]` (userId list). When `requireMention: true` (default) AND `botUserId` is configured, the adapter checks whether `botUserId in mentionees` before dispatching.

```ts
const adapter = new LineAdapter({
  channelSecret: ...,
  channelAccessToken: ...,
  botUserId: "Uxxxxxx",  // your bot's LINE user ID
  requireMention: true,
});
```

If `botUserId` is unset, the mention guard is disabled (all messages dispatch).

## Event-type filter (EC-4 absorbed)

LINE webhook delivers 9 event types: `message`, `follow`, `unfollow`, `join`, `leave`, `postback`, `beacon`, `accountLink`, `things`. The adapter dispatches **only `message` events of type `text`**. Other event types — including image/audio/video/sticker/location/postback — are filtered before reaching your handler in v0.1. No TypeErrors on unexpected events.

## Channel-type mapping (D410)

| LINE source.type | Adapter `channel.type` |
|---|---|
| `user` (1:1) | `"dm"` |
| `group` | `"group"` |
| `room` (ad-hoc multi-user) | `"group"` |

`event.line.sourceType` preserves the original.

## Multipart split (D411)

LINE caps text messages at 5000 chars. The adapter splits longer text into surrogate-safe chunks (grapheme-cluster boundaries via `Intl.Segmenter`), each ≤5000 chars. Each chunk is one billable message (Push API after free tier).

## What's NOT supported in v0.1

| Feature | Status | Workaround |
|---|---|---|
| Flex Message | Deferred to v0.2 (D412) | `adapter.getClient().pushMessage(userId, flexMessage)` |
| Carousel template | Deferred to v0.2 (D412) | Same |
| Image/audio/video/sticker inbound | Filtered (EC-4) | Read via `event.line.raw` if needed |
| Quick replies | Deferred to v0.2 | — |
| Rich menu | Deferred to v0.2 | — |

## ADRs

D405 – D412 in `.claude/knowledge-base/adrs/`.
