# @theokit/gateway-qq

QQ Bot (Tencent QQ official bot) platform adapter for [`@theokit/gateway`](../gateway). Inbound is
the bot's signed webhook (`C2C_MESSAGE_CREATE`, a direct message); outbound is the C2C message API.
The access token is fetched from the AppID and AppSecret and refreshed before it expires.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { QQAdapter } from "@theokit/gateway-qq";

const adapter = new QQAdapter({
  appId: process.env.QQ_APP_ID!,
  clientSecret: process.env.QQ_CLIENT_SECRET!,
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

- Signature: Ed25519 over `timestamp + rawBody`, with the key derived from the AppSecret as QQ
  documents; timestamp within five minutes; a failure answers 401 and dispatches nothing.
- Endpoint validation (`op` 13, sent when you register the callback URL) is answered with `body`
  (`plain_token` and `signature`); send it back as the JSON response.
- Inbound: direct messages become events (`channel.id` = the sender's `user_openid`). Other events
  and repeats are acknowledged and dropped. With no handler subscribed the answer is 503 so QQ
  redelivers.
- Outbound: text only; markdown loses its markers; over 2000 characters goes as several messages.
  A reply that sets `replyTo` sends it as `msg_id` (passive reply) with a `msg_seq` per part.
  Attachments are refused with `attachments_unsupported`. A non-zero `code` becomes
  `qq_send_failed`.
- Groups, guild channels and rich media are not handled. `apiBase` selects the sandbox.

## Status

Unverified: no send-and-receive run against a real QQ bot has been recorded; the wire shapes are
written from QQ's public bot documentation. The live suite needs a QQ Open Platform bot account.
