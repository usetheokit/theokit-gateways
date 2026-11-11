# @theokit/gateway-qq

QQ Bot platform adapter for [`@theokit/gateway`](../gateway). Inbound is the QQ Bot WebSocket
gateway (direct messages and group @-mentions); outbound is the OpenAPI v2 message API
(`POST /v2/users/{openid}/messages`, `POST /v2/groups/{group_openid}/messages`). The access token is
fetched from the AppID and AppSecret and refreshed before it expires.

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
```

Use `apiBase: "https://sandbox.api.sgroup.qq.com"` for a bot still in the sandbox.

## Behaviour

- `connect()` answers `true` on `READY`, `false` (never a throw) on a refusal or after 30 s.
- A reply is a passive reply to `replyTo` or to the last message received from that user or group;
  QQ limits active (non-reply) messages.
- Text only: an outbound with attachments is refused with `attachments_unsupported`.
- Replies over 1500 characters are split.

## Status

Unverified: no live run yet. The wire shapes are written from QQ's public documentation; the live
suite needs a QQ Bot application, its AppID and AppSecret, and a user who has added the bot.
