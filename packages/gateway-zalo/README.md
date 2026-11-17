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

## Channel descriptor

`zaloChannel` describes this channel as data for `createChannels` and `configFromEnv` from `@theokit/gateway`. Its `transport` is `"socket"` for now (no `webhook` half yet): the app still routes inbound webhooks to the adapter itself.

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { zaloChannel } from "@theokit/gateway-zalo";

const { config, missing } = configFromEnv(zaloChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([{ descriptor: zaloChannel, config }]);
```

| Config key | Env variable | Required | Secret |
| --- | --- | --- | --- |
| `appId` | `ZALO_APP_ID` | yes | no |
| `oaSecretKey` | `ZALO_OA_SECRET_KEY` | yes | yes |
| `accessToken` | `ZALO_ACCESS_TOKEN` | yes | yes |
| `apiBase` | `ZALO_API_BASE` | no | no |
