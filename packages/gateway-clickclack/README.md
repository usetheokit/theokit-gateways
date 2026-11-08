# @theokit/gateway-clickclack

ClickClack platform adapter for [`@theokit/gateway`](../gateway). It follows a workspace's realtime
WebSocket and posts replies over REST, both with a ClickClack **bot token**.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { ClickClackAdapter } from "@theokit/gateway-clickclack";

const adapter = new ClickClackAdapter({
  baseUrl: "https://chat.example.com",
  token: process.env.CLICKCLACK_TOKEN ?? "", // `clickclack admin bot create`; bot:write + realtime:read
  workspaceId: "...",
  botUserId: "...", // events the bot authored are ignored
});
const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (_event, ctx) => ctx.reply("hello"),
});
await runner.start();
```

## Behaviour

- Inbound: `message.created` events with a text body, from anyone but the bot; repeats are dropped.
  A dropped socket is reopened from the last cursor (`after_cursor`); on `resync_required` it
  reopens from now.
- Outbound: `POST /api/channels/{channel.id}/messages`; markdown loses its markers; a reply over
  4000 characters goes as several messages. Attachments are refused with `attachments_unsupported`.
  Replies go to the channel, not into a thread.

## Status

Unverified. The endpoints and event field names are written from ClickClack's public documentation
and tested against scripted fakes; no send-and-receive run against a real server has been
recorded. Confirm the field names (`channel_id`, `author_user_id`, `body`) against a live server
before relying on this.
