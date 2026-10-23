# @theokit/gateway-feishu-lark

Feishu / Lark platform adapter for [`@theokit/gateway`](../gateway), built on the open platform's
own SDK, [`@larksuiteoapi/node-sdk`](https://github.com/larksuite/node-sdk).

## How inbound arrives

**The SDK's long connection.** The adapter opens an outbound WebSocket to the open platform and
receives `im.message.receive_v1` events on it, so there is no public endpoint to host. Enable the
long-connection event mode for the app and subscribe to `im.message.receive_v1`.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-feishu-lark @larksuiteoapi/node-sdk
```

The SDK is an optional peer: the adapter loads it the first time it connects.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { FeishuLarkAdapter } from "@theokit/gateway-feishu-lark";

const adapter = new FeishuLarkAdapter({
  appId: process.env.LARK_APP_ID ?? "",
  appSecret: process.env.LARK_APP_SECRET ?? "",
  domain: "lark", // or "feishu", the default
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`);
  },
});
await runner.start();
```

## What the adapter does

- `domain` picks the open platform, `"feishu"` (open.feishu.cn) or `"lark"` (open.larksuite.com),
  for both the API client and the long connection.
- `connect()` fetches a tenant access token, which proves the App ID and Secret, then opens the long
  connection. It answers `false`, never a throw, when either fails or 10000 ms pass. The App ID must
  be `cli_` and 16 hex characters; anything else throws at construction.
- Each text message from a user becomes a `FeishuLarkMessageEvent`. Messages an app sent, and
  messages that are not text, produce no event. A message whose content is not JSON is logged and
  skipped.
- Lark redelivers an event it thinks was not acknowledged within 3 seconds. The handler runs after
  the SDK's dispatcher has returned, so the acknowledgement is not held by a slow handler, and the
  last 1000 event ids are remembered, so a redelivered event is answered once.
- **Reconnects are the SDK's.** The long connection keeps the SDK's own reconnect, which retries on
  the interval Feishu's servers set; the adapter runs no loop of its own. When the SDK gives up, the
  adapter writes one line to stderr and reads as disconnected.
- `sendMessage` creates a text message in `channel.id` (the chat id, `oc_…`), or replies to
  `replyTo` when it is set. A non-zero code from the open platform is `lark_api_error` with the
  code and message; no answer within 30000 ms is `timeout`. `markdown` loses its markers: Lark's
  rich post format is not mapped yet.

## Known limits

- In a group, a mention arrives in the text as a placeholder such as `@_user_1`; mentions are not
  resolved to names yet.
- With several processes connected for one app, Lark delivers each event to one of them at random.
  Run one bot process per app.
- While the SDK is reconnecting (its default is to retry without limit), the adapter still reads as
  connected; a send in that window fails with Lark's own error. Only the SDK giving up marks it
  disconnected.
- An event id is remembered when the event arrives, before any handler runs, so an event that
  arrives while no handler is subscribed is not delivered on Lark's redelivery either.
