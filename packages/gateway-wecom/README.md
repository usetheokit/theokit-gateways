# @theokit/gateway-wecom

WeCom (企业微信) **self-built application** platform adapter for [`@theokit/gateway`](../gateway).
Inbound is the application's callback URL (signed, AES-encrypted XML); outbound is the application
message API (`POST https://qyapi.weixin.qq.com/cgi-bin/message/send`). The access token is fetched
from the CorpID and Secret and refreshed before it expires.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { WeComAdapter } from "@theokit/gateway-wecom";

const adapter = new WeComAdapter({
  corpId: process.env.WECOM_CORP_ID!,
  corpSecret: process.env.WECOM_CORP_SECRET!,
  agentId: process.env.WECOM_AGENT_ID!,
  token: process.env.WECOM_TOKEN!,
  encodingAesKey: process.env.WECOM_ENCODING_AES_KEY!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();

// in your HTTPS callback route (give POST the RAW body):
const q = request.query; // msg_signature, timestamp, nonce, echostr
const answer = await adapter.handleWebhook(q, request.method === "POST" ? rawBody : undefined);
response.status(answer.status).send(answer.body);
```

## Behaviour

- Signature: `sha1(sort([token, timestamp, nonce, encrypted]).join(""))`, compared in constant
  time; a failure answers 401 and dispatches nothing. `GET` with a valid signature answers the
  decrypted `echostr`. The envelope must be for the configured corp id.
- Inbound: text messages become direct-message events (`channel.id` = the sender's user id). Other
  message types and repeats are acknowledged (`success`) and dropped. With no handler subscribed
  the answer is 503 so WeCom retries.
- Outbound: text only; markdown loses its markers; over 600 characters goes as several messages
  (WeCom caps a text message at 2048 bytes). Attachments are refused with
  `attachments_unsupported`. A non-zero `errcode` becomes `wecom_send_failed` (for instance, the
  server IP is not on the application's trusted list). The send result carries no message id.
- Scope: self-built applications, not the group-chat webhook robot or the AI bot long connection.

## Status

Unverified: no send-and-receive run against a real WeCom corp has been recorded. Wire shapes are
written from WeCom's server API documentation and tested against a scripted fake.

## Capabilities

`adapter.capabilities` reports `maxMessageChars` is the splitter's limit (exported from this package) and `threads` is `false`; other fields follow the defaults of `@theokit/gateway`.

## Channel descriptor

`wecomChannel` describes the channel as data, for `createChannels` and `configFromEnv` from
`@theokit/gateway`.

| Field | Env | Required | Secret |
| --- | --- | --- | --- |
| `corpId` | `WECOM_CORP_ID` | yes | no |
| `corpSecret` | `WECOM_CORP_SECRET` | yes | yes |
| `agentId` | `WECOM_AGENT_ID` | yes | no |
| `token` | `WECOM_TOKEN` | yes | yes |
| `encodingAesKey` | `WECOM_ENCODING_AES_KEY` | yes | yes |

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { wecomChannel } from "@theokit/gateway-wecom";

const { config, missing } = configFromEnv(wecomChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([
  { descriptor: wecomChannel, config, envPrefix: "APP_" },
]);
```

Pass the same prefix as `envPrefix` to `createChannels`: a missing required value is then rejected with
`missing_required_config` naming the full variable (for example `APP_WECOM_CORP_ID`).

The descriptor is constructor-only (`transport: "socket"`); your app still mounts the callback route.

`create` refuses a value of the wrong type with a `GatewayConfigurationError` (`invalid_config`,
naming the key) and makes no network call.

## Mount with `createWebhookHandler`

`wecomChannel` declares `transport: "webhook"`, so one Fetch route serves it:

```ts
import { configFromEnv, createChannels, createWebhookHandler } from "@theokit/gateway";
import { wecomChannel } from "@theokit/gateway-wecom";

const { adapters, channels } = createChannels([
  { descriptor: wecomChannel, config: configFromEnv(wecomChannel, process.env).config },
]);
// Subscribe with adapter.onInbound(...) and start the adapters, then:
export const onWebhook = createWebhookHandler({ channels, isStarted: () => true });
// Route `/webhooks/wecom` to onWebhook(request).
```

The route takes `GET` (the callback-URL check, answered with the decrypted `echostr`) and `POST` (encrypted XML). The `msg_signature` is read from the query; a wrong one is a 401, and a 503 (no handler subscribed) stays 503 so WeCom retries.
