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

## Webhook descriptor

`zaloChannel` is a `ChannelDescriptor` with `transport: "webhook"`: the platform pushes inbound events to your HTTPS route, so there is no socket to open. Pass it to `createChannels` and `createWebhookHandler` from `@theokit/gateway`, or call `webhook.verify(adapter, request)` and then `webhook.ingest(adapter, payload)` yourself. `create` reads `appId`, `oaSecretKey`, `accessToken` (and an optional `apiBase`).

- `verify` checks the signature headers (`x-zevent-signature`, any case) against the raw body and returns `false` for a missing or bad signature.
- `ingest` returns `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a message arrives and nothing is subscribed (answer non-2xx so the platform redelivers), and `"delivered"` otherwise; repeats and events that are not text messages are acknowledged as `"delivered"` without a second dispatch.

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
