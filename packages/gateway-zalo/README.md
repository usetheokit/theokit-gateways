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
  accessToken: process.env.ZALO_ACCESS_TOKEN!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();

// in your HTTPS webhook route (give it the RAW body):
const answer = await adapter.handleWebhook(rawBody, request.headers["x-zevent-signature"]);
response.status(answer.status).end();
```

## Webhook channel

`zaloChannel` describes the package as data: `transport: "webhook"`, config keys `appId`,
`oaSecretKey` and `accessToken` (env `ZALO_APP_ID`, `ZALO_OA_SECRET_KEY`, `ZALO_ACCESS_TOKEN`).
Its `webhook.verify` checks the `X-ZEvent-Signature` header and `webhook.ingest` dispatches the
event, so `createWebhookHandler` from `@theokit/gateway` serves the route over Fetch
(`POST /webhooks/zalo`): 401 for a bad signature, 503 when no handler is subscribed.

With `configFromEnv(descriptor, process.env, "APP_")` the required values are read from `APP_ZALO_*`; secrets (`appSecret`-style keys and tokens) are returned in `.secrets` for log masking. Optional endpoint overrides: `ZALO_API_BASE` (optional `apiBase`). A value of the wrong type makes `create` throw `ConfigurationError` with code `invalid_config` naming the key.

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
