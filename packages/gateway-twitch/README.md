# @theokit/gateway-twitch

Twitch chat platform adapter for [`@theokit/gateway`](../gateway): chat messages arrive over an
EventSub WebSocket and replies go out through Helix Send Chat Message.

## How inbound arrives

**An outbound WebSocket.** The adapter opens an EventSub session and subscribes it to
`channel.chat.message` for each channel the bot reads. There is no webhook to host.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-twitch
```

The package has no runtime dependencies: the socket is Node's global `WebSocket` (Node 22.12 or
later) and Helix is called with `fetch`.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { TwitchAdapter } from "@theokit/gateway-twitch";

const adapter = new TwitchAdapter({
  accessToken: process.env.TWITCH_ACCESS_TOKEN ?? "",
  botUserId: "123456789",
  broadcasterUserIds: ["987654321"],
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

- `connect()` validates the token: it must belong to `botUserId` and carry `user:read:chat` and
  `user:write:chat`. It then opens the EventSub socket and subscribes every broadcaster on the
  session's welcome; it answers `true` once every subscription is accepted (202), and `false`,
  never a throw, on any refusal or after 10000 ms. A refused subscription closes the socket.
- Each `channel.chat.message` notification becomes one `TwitchMessageEvent` whose `channel.id` is
  the broadcaster's user id. A notification repeated with the same `message_id` (as during a
  reconnect handover) is delivered once, the last 1000 ids remembered, and the bot's own messages
  produce no event.
- **Keeping the session.** A socket silent for longer than the welcome's
  `keepalive_timeout_seconds` plus 5 s is closed and replaced; a dropped socket is reopened after
  1000 ms, doubling up to 30000 ms (back to 1000 ms after a session that stayed up 60000 ms), and
  the new session is subscribed again. A `session_reconnect` opens the URL Twitch names, and the old
  socket closes once the new one is welcomed; the subscriptions carry over. A revoked subscription
  is logged once with its type, broadcaster and status.
- `sendMessage` sends to `channel.id`, the broadcaster's numeric user id. A reply over 500
  characters goes as several messages, in order, and the answer carries the last one's id. A message
  Twitch did not send is `twitch_message_dropped` with Twitch's reason; another HTTP error is
  `twitch_api_error` with its status; no answer within 30000 ms is `timeout`. `markdown` loses its
  markers.

## Known limits

- The adapter does not refresh the access token. When it expires, `connect()` fails with the
  validator's error; supply a refreshed token.
