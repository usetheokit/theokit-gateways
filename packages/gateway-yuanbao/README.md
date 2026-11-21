# @theokit/gateway-yuanbao

Tencent Yuanbao (元宝) **bot** platform adapter for [`@theokit/gateway`](../gateway). Inbound is the
bot's signed JSON callback; outbound is the bot message API. The access token is fetched from the
app id and secret and refreshed before it expires.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { YuanbaoAdapter } from "@theokit/gateway-yuanbao";

const adapter = new YuanbaoAdapter({
  appId: process.env.YUANBAO_APP_ID!,
  appSecret: process.env.YUANBAO_APP_SECRET!,
  callbackSecret: process.env.YUANBAO_CALLBACK_SECRET!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();

// in your HTTPS callback route (give it the RAW body):
const answer = await adapter.handleWebhook(
  rawBody,
  request.headers["x-signature"],
  request.headers["x-timestamp"],
);
response.status(answer.status).end();
```

## Webhook channel

`yuanbaoChannel` describes the package as data: `transport: "webhook"`, config keys `appId`,
`appSecret` and `callbackSecret` (env `YUANBAO_APP_ID`, `YUANBAO_APP_SECRET`,
`YUANBAO_CALLBACK_SECRET`). Its `webhook.verify` checks the `X-Signature` and `X-Timestamp`
headers and `webhook.ingest` dispatches the event, so `createWebhookHandler` from
`@theokit/gateway` serves the route over Fetch (`POST /webhooks/yuanbao`): 401 for a bad
signature, 503 when no handler is subscribed.

With `configFromEnv(descriptor, process.env, "APP_")` the required values are read from `APP_YUANBAO_*`; secrets (`appSecret`-style keys and tokens) are returned in `.secrets` for log masking. Optional endpoint overrides: `YUANBAO_API_BASE` (optional `apiBase`). A value of the wrong type makes `create` throw `ConfigurationError` with code `invalid_config` naming the key.

## Behaviour

- Signature: hex `HMAC-SHA256(callbackSecret, timestamp + "." + rawBody)`, compared in constant
  time, timestamp within five minutes; a failure answers 401 and dispatches nothing.
- Inbound: text messages become direct-message events (`channel.id` = the sender's user id). Other
  events and repeats are acknowledged and dropped. With no handler subscribed the answer is 503 so
  Yuanbao redelivers.
- Outbound: text only; markdown loses its markers; over 2000 characters goes as several messages.
  Attachments are refused with `attachments_unsupported`. A non-zero `code` becomes
  `yuanbao_send_failed`.

## Status

Unverified: no send-and-receive run against a real Yuanbao bot has been recorded, and no public
Yuanbao bot specification was available, so endpoints, header names and payload shapes are an
assumption written to be changed in one place. The live suite needs a bot account.

## Capabilities

`adapter.capabilities` reports `maxMessageChars` is the splitter's limit (exported from this package) and `threads` is `false`; other fields follow the defaults of `@theokit/gateway`.
