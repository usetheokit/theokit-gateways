# @theokit/gateway-zalo

Zalo **Official Account** (OA) platform adapter for [`@theokit/gateway`](../gateway). Inbound is the
OA webhook; outbound is the OA Open API customer-service message
(`POST https://openapi.zalo.me/v3.0/oa/message/cs`). For a personal account see
[`@theokit/gateway-zalo-personal`](../gateway-zalo-personal).

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { ZaloAdapter } from "@theokit/gateway-zalo";

const adapter = new ZaloAdapter({
  appId: process.env.ZALO_APP_ID!,
  oaSecretKey: process.env.ZALO_OA_SECRET_KEY!,
  accessToken: process.env.ZALO_OA_ACCESS_TOKEN!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();

// in your HTTPS webhook route (give it the RAW body):
const answer = await adapter.handleWebhook(rawBody, request.headers["x-zevent-signature"]);
response.status(answer.status).end();
```

## Webhook transport

`zaloChannel` declares `transport: "webhook"` with a `webhook` part (`methods: ["POST"]`, `verify`,
`ingest`), so a host mounts it with `createWebhookHandler` from `@theokit/gateway`: it
verifies the `X-ZEvent-Signature` header, dispatches the event, and answers 401 for a rejected signature, 503 when no handler
is subscribed and 405 for other methods. `adapter.handleWebhook` stays available for a route you
write yourself.

```ts
import { createChannels, createWebhookHandler } from "@theokit/gateway";
import { zaloChannel } from "@theokit/gateway-zalo";

const { channels } = createChannels([{ descriptor: zaloChannel, config: { /* appId, oaSecretKey, accessToken */ } }]);
const handler = createWebhookHandler({ channels, isStarted: () => true }); // POST /webhooks/zalo
```

## Behaviour

- Signature: `X-ZEvent-Signature: mac=sha256(appId + rawBody + timestamp + oaSecretKey)`, compared in
  constant time; a failure answers 401 and dispatches nothing.
- Inbound: `user_send_text` events become direct-message events (`channel.id` = the user id).
  Other events, other apps' events and repeats are acknowledged and dropped. With no handler
  subscribed the answer is 503 so Zalo redelivers.
- Outbound: text only; markdown loses its markers; over 2000 characters goes as several messages.
  Attachments are refused with `attachments_unsupported`. Zalo's non-zero `error` becomes
  `zalo_send_failed` (for instance, the user is outside the 48-hour reply window).
- The access token expires; this adapter does not refresh it.

## Status

Unverified: no send-and-receive run against a real Zalo OA account has been recorded. Wire shapes
are written from Zalo's OA documentation and tested against a scripted fake.

## Capabilities

`adapter.capabilities` reports `maxMessageChars` is the splitter's limit (exported from this package) and `threads` is `false`; other fields follow the defaults of `@theokit/gateway`.
