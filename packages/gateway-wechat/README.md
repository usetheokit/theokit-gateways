# @theokit/gateway-wechat

WeChat (Weixin) **Official Account** platform adapter for [`@theokit/gateway`](../gateway). Inbound
is the account's server-URL webhook (signed XML); outbound is the customer-service message API
(`POST https://api.weixin.qq.com/cgi-bin/message/custom/send`). The access token is fetched from
the AppID and AppSecret and refreshed before it expires.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { WeChatAdapter } from "@theokit/gateway-wechat";

const adapter = new WeChatAdapter({
  appId: process.env.WECHAT_APP_ID!,
  appSecret: process.env.WECHAT_APP_SECRET!,
  token: process.env.WECHAT_TOKEN!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();

// in your HTTPS server-URL route (give POST the RAW body):
const q = request.query; // signature, timestamp, nonce, echostr
const answer = await adapter.handleWebhook(q, request.method === "POST" ? rawBody : undefined);
response.status(answer.status).send(answer.body);
```

## Behaviour

- Signature: `sha1(sort([token, timestamp, nonce]).join(""))`, compared in constant time; a
  failure answers 401 and dispatches nothing. `GET` with a valid signature echoes `echostr`.
- Freshness: a request whose `timestamp` is more than 300 seconds from the server clock answers
  401 (`stale timestamp`), so keep the host clock in sync. A `POST` whose timestamp and nonce
  were already accepted with a different body answers 401 (`nonce reused`); an identical
  request sent again reaches the message-id dedupe instead, so a retry is never refused for its
  nonce. Accepted
  nonces live in memory, per adapter instance and per process.
- Plain mode does not authenticate the body. The signature covers only the token, timestamp and
  nonce, all in the query string. Treat webhook URLs as secrets for their 300 seconds: keep them
  out of logs that others can read, and do not let the sender's OpenID alone authorize anything
  sensitive.
- Inbound: text messages become direct-message events (`channel.id` = the sender's OpenID). Other
  message types and repeats are acknowledged (`success`) and dropped. With no handler subscribed
  the answer is 503 so WeChat retries. Plain-text mode only; encrypted (安全模式) is not supported.
- Outbound: text only; markdown loses its markers; over 600 characters goes as several messages
  (WeChat caps a text message at 2048 bytes). Attachments are refused with
  `attachments_unsupported`. A non-zero `errcode` becomes `wechat_send_failed` (for instance, the
  user is outside the 48-hour customer-service window). The send result carries no message id.
- Scope: this is the Official Account (公众号) API, not WeCom, Yuanbao or QQ Bot.

## Status

Unverified: no send-and-receive run against a real WeChat account has been recorded. Wire shapes
are written from WeChat's Official Account documentation and tested against a scripted fake.

## Capabilities

`adapter.capabilities.maxMessageChars` is `600` (the splitter limit) and `threads` is `false`. See `@theokit/gateway` for the field meanings.

## Channel descriptor

`wechatChannel` describes the channel as data, for `createChannels` and `configFromEnv` from
`@theokit/gateway`.

| Field | Env | Required | Secret |
| --- | --- | --- | --- |
| `appId` | `WECHAT_APP_ID` | yes | no |
| `appSecret` | `WECHAT_APP_SECRET` | yes | yes |
| `token` | `WECHAT_TOKEN` | yes | yes |

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { wechatChannel } from "@theokit/gateway-wechat";

const { config, missing } = configFromEnv(wechatChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([
  { descriptor: wechatChannel, config, envPrefix: "APP_" },
]);
```

Pass the same prefix as `envPrefix` to `createChannels`: a missing required value is then rejected with
`missing_required_config` naming the full variable (for example `APP_WECHAT_APP_ID`).

The descriptor is constructor-only (`transport: "socket"`); your app still mounts the callback route.

`create` refuses a value of the wrong type with a `GatewayConfigurationError` (`invalid_config`,
naming the key) and makes no network call.

## Mount with `createWebhookHandler`

`wechatChannel` declares `transport: "webhook"`, so one Fetch route serves it:

```ts
import { configFromEnv, createChannels, createWebhookHandler } from "@theokit/gateway";
import { wechatChannel } from "@theokit/gateway-wechat";

const { adapters, channels } = createChannels([
  { descriptor: wechatChannel, config: configFromEnv(wechatChannel, process.env).config },
]);
// Subscribe with adapter.onInbound(...) and start the adapters, then:
export const onWebhook = createWebhookHandler({ channels, isStarted: () => true });
// Route `/webhooks/wechat` to onWebhook(request).
```

The route takes `GET` (the server-URL check, answered with the `echostr`) and `POST`. The signature is read from the query; a wrong one is a 401, and a 503 (no handler subscribed) stays 503 so WeChat retries.
