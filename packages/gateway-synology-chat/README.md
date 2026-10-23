# @theokit/gateway-synology-chat

Synology Chat platform adapter for [`@theokit/gateway`](../gateway), for a bot created under
Synology Chat → Integration → Bots.

## How inbound arrives

**A webhook.** Synology Chat posts each message a user sends the bot to the bot's Outgoing URL,
which is the adapter's own listener (or a route on your Express app). The NAS must be able to reach
that URL.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-synology-chat express
```

`express` is an optional peer, loaded when the adapter connects.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { SynologyChatAdapter } from "@theokit/gateway-synology-chat";

const adapter = new SynologyChatAdapter({
  botToken: process.env.SYNOLOGY_CHAT_BOT_TOKEN ?? "",
  incomingUrl: process.env.SYNOLOGY_CHAT_INCOMING_URL ?? "",
  port: 3000, // the Outgoing URL is http(s)://<this host>:3000/synology-chat
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`);
  },
});
await runner.start();
```

Pass `app` to mount the route on an Express app you already run; the adapter then opens no port.

## What the adapter does

- `connect()` calls `user_list` through the Incoming URL, which proves the URL and its token, and
  starts the listener. It answers `false`, never a throw, when the NAS refuses, does not answer
  within `connectTimeoutMs` (10000 ms), or the port is taken.
- **Callbacks.** The `token` of every callback is compared with `botToken` in constant time; a
  missing or empty one is answered 400 and a wrong one 401, and the handler does not run. The body
  can be form-encoded or JSON, at most 1 MiB (413 above). A `user_id` that is not digits, or a
  missing `text`, is 400. A `post_id` already delivered is answered 200 and not delivered again (the
  last 1000 are remembered); a callback with no `post_id` is always delivered. With no handler
  subscribed the answer is 503.
- **Replies.** `sendMessage` posts to the Incoming URL with `user_ids: [<channel.id>]`, so
  `channel.id` must be the user's numeric id; anything else is `invalid_channel` before any request.
  A refusal is `synology_api_error` with the NAS's error code; no answer within 30000 ms is
  `timeout`. `markdown` loses its markers.
- The Incoming URL holds a token, so no error or log line the adapter writes contains it.
- A bot reply is not known to call the bot back; the live suite fails if it does.
