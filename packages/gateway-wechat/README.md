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
