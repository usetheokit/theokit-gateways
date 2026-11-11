# @theokit/gateway-qq

QQ Bot platform adapter for [`@theokit/gateway`](../gateway). Inbound is the QQ Bot gateway
WebSocket (hello, identify or resume, heartbeat, reconnect with backoff); outbound is the OpenAPI
v2 message endpoints. The access token is fetched from the AppID and AppSecret and refreshed
before it expires.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { QQAdapter } from "@theokit/gateway-qq";

const adapter = new QQAdapter({
  appId: process.env.QQ_APP_ID!,
  clientSecret: process.env.QQ_APP_SECRET!,
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();
```

## Behaviour

- Inbound: `C2C_MESSAGE_CREATE` becomes a `dm` event (`channel.id` = the user's openid) and
  `GROUP_AT_MESSAGE_CREATE` a `group` event (`channel.id` = the group openid). Repeats are dropped.
  Default intents are `1 << 25` (group and C2C); override with `intents`.
- Outbound: text only. A reply is a passive reply to the channel's latest inbound message id (or
  `replyTo`) with a rising `msg_seq`; QQ accepts it for a limited time after the inbound message.
  Markdown loses its markers; over 1500 characters goes as several messages. Attachments are
  refused with `attachments_unsupported`. A QQ error becomes `qq_send_failed` with QQ's code.
- Scope: guild (channel) messages are not subscribed. Use `apiBase` for the sandbox host.

## Status

Unverified: no send-and-receive run against a real QQ Bot account has been recorded. Wire shapes
are written from the QQ Bot documentation and tested against a scripted fake.
