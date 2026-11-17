# @theokit/gateway-buzz

Buzz platform adapter for [`@theokit/gateway`](../gateway). It follows a workspace's realtime
WebSocket and posts replies over REST, both with a Buzz **bot token**.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { BuzzAdapter } from "@theokit/gateway-buzz";

const adapter = new BuzzAdapter({
  baseUrl: "https://chat.example.com",
  token: process.env.BUZZ_TOKEN ?? "", // the Buzz admin console; bot:write + realtime:read
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

Unverified. Buzz publishes no API specification that this package could read offline, so the
endpoints and event field names (`/api/channels/{id}/messages`, `/api/realtime/ws`, `channel_id`,
`author_user_id`, `body`) are an **assumption** modelled on the ClickClack-style bot API and tested
against scripted fakes. No send-and-receive run against a real Buzz account has been recorded; the
live suite is `integration/tests/buzz/live.test.ts`. Confirm the wire shapes against a live server
before relying on this.
