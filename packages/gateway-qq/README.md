# @theokit/gateway-qq

QQ **Bot** (Tencent QQ open platform) adapter for [`@theokit/gateway`](../gateway). Inbound is the
bot's signed webhook; outbound is the C2C (direct message) API. The access token is fetched from the
AppID and AppSecret and refreshed before it expires. Direct messages only: group and channel
messages are acknowledged and dropped.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { QQAdapter } from "@theokit/gateway-qq";

const adapter = new QQAdapter({
  appId: process.env.QQ_APP_ID!,
  appSecret: process.env.QQ_APP_SECRET!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();

// in your HTTPS callback route (give it the RAW body):
const answer = await adapter.handleWebhook(
  rawBody,
  request.headers["x-signature-ed25519"],
  request.headers["x-signature-timestamp"],
);
response.status(answer.status).json(answer.body ?? {});
```

## Webhook descriptor

`qqChannel` is a `ChannelDescriptor` with `transport: "webhook"`: the platform pushes inbound events to your HTTPS route, so there is no socket to open. Pass it to `createChannels` and `createWebhookHandler` from `@theokit/gateway`, or call `webhook.verify(adapter, request)` and then `webhook.ingest(adapter, payload)` yourself. `create` reads `appId`, `appSecret` (and an optional `apiBase`).

- `verify` checks the signature headers (`x-signature-ed25519` and `x-signature-timestamp`, any case) against the raw body and returns `false` for a missing or bad signature.
- `ingest` returns `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a message arrives and nothing is subscribed (answer non-2xx so the platform redelivers), and `"delivered"` otherwise; repeats and events that are not text messages are acknowledged as `"delivered"` without a second dispatch. The callback URL validation (`op` 13) is unsigned, so the descriptor also defines `handle`, which answers it with `{ plain_token, signature }` (JSON) and otherwise runs `QQAdapter.handleWebhook`.

## Behaviour

- Callback URL validation (`op` 13): answered with `{ plain_token, signature }` in `answer.body`.
- Signature: Ed25519 over `timestamp + rawBody`, key derived from the AppSecret (repeated to 32
  bytes as the seed); timestamp within five minutes; a failure answers 401 and dispatches nothing.
- Inbound: `C2C_MESSAGE_CREATE` becomes a direct-message event (`channel.id` = the sender's
  `user_openid`). Other events and repeats are acknowledged and dropped. With no handler subscribed
  the answer is 503 so QQ redelivers.
- Outbound: text only; markdown loses its markers; over 2000 characters goes as several messages.
  A reply to a user whose message was just received is a passive reply (`msg_id`, `msg_seq`).
  Attachments are refused with `attachments_unsupported`. An error `code` becomes `qq_send_failed`.

## Status

Unverified: no send-and-receive run against a real QQ Bot has been recorded. The wire shapes are
written from the QQ Bot open platform docs. The live suite needs a QQ Bot (AppID, AppSecret) and a
user who has messaged it.

## Capabilities

`adapter.capabilities.maxMessageChars` is `2000` (the splitter limit) and `threads` is `false`. See `@theokit/gateway` for the field meanings.
