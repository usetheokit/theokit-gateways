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
