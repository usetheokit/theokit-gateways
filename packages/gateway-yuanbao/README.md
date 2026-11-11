# @theokit/gateway-yuanbao

Tencent **Yuanbao** bot platform adapter for [`@theokit/gateway`](../gateway). Inbound is an
HMAC-signed JSON webhook; outbound is the bot message API. A token is fetched from the app key and
secret and refreshed before it expires.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { YuanbaoAdapter } from "@theokit/gateway-yuanbao";

const adapter = new YuanbaoAdapter({
  appKey: process.env.YUANBAO_APP_KEY!,
  appSecret: process.env.YUANBAO_APP_SECRET!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();

// in your HTTPS webhook route (give it the RAW body):
const answer = await adapter.handleWebhook(
  { signature: q.signature, timestamp: q.timestamp, nonce: q.nonce },
  rawBody,
);
response.status(answer.status).send(answer.body);
```

## Behaviour

- Signature: `hex(HMAC-SHA256(appSecret, timestamp + nonce + rawBody))`, compared in constant time;
  a failure answers 401 and dispatches nothing.
- Inbound: text messages become direct-message events (`channel.id` = the sender's account id).
  Other message types and repeats are acknowledged and dropped. With no handler subscribed the
  answer is 503 so Yuanbao retries.
- Outbound: text only; markdown loses its markers; over 2000 characters goes as several messages.
  Attachments are refused with `attachments_unsupported`. A non-zero `code` becomes
  `yuanbao_send_failed`. The send result carries no message id.

## Status

**Unverified, and the wire shapes are an assumption.** No Yuanbao bot spec was available when this
was written, so the endpoints (`/api/v5/robotLogic/sign-token`, `/api/v1/bot/message/send`), the
signature scheme and the webhook JSON fields are best guesses, tested only against a scripted fake.
No send-and-receive run against a real Yuanbao bot account has been recorded; the live suite
(`integration/tests/yuanbao`) needs a bot app key and secret. Expect to adjust them on first live run.
