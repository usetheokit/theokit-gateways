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

## Channel descriptor

`qqChannel` describes the channel as data: `transport` is `"webhook"` (inbound events arrive by HTTP
callback, there is no socket), and `webhook.verify` / `webhook.ingest` implement the contract
`createWebhookHandler` from `@theokit/gateway` calls. `verify` reads `x-signature-ed25519` and `x-signature-timestamp`. The callback URL validation (op 13) is signed by the adapter rather than by QQ, so the descriptor also provides `handle`, which answers it with the signed JSON body.
`ingest` answers `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a text
message arrives with no handler subscribed (answer non-200 so the platform redelivers), and
`"delivered"` otherwise. `create` refuses a credential that is not a string.

## Status

Unverified: no send-and-receive run against a real QQ Bot has been recorded. The wire shapes are
written from the QQ Bot open platform docs. The live suite needs a QQ Bot (AppID, AppSecret) and a
user who has messaged it.

## Capabilities

`adapter.capabilities.maxMessageChars` is `2000` (the splitter limit) and `threads` is `false`. See `@theokit/gateway` for the field meanings.
