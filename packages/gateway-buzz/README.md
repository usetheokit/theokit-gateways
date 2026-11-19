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

## Capabilities

`adapter.capabilities` reports `maxMessageChars` is the splitter's limit (exported from this package) and `threads` is `false`; other fields follow the defaults of `@theokit/gateway`.

## Channel descriptor

`buzzChannel` describes this channel as data for `createChannels` and `configFromEnv` in
`@theokit/gateway`: a `socket` channel (the adapter opens its own realtime connection).

| Config key | Environment variable | Required | Secret |
| --- | --- | --- | --- |
| `baseUrl` | `BUZZ_BASE_URL` | yes | no |
| `token` | `BUZZ_TOKEN` | yes | yes |
| `workspaceId` | `BUZZ_WORKSPACE_ID` | yes | no |
| `botUserId` | `BUZZ_BOT_USER_ID` | yes | no |
| `reconnectDelayMs` | `BUZZ_RECONNECT_DELAY_MS` | no | no |

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { buzzChannel } from "@theokit/gateway-buzz";

const { config, missing, secrets } = configFromEnv(buzzChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([{ descriptor: buzzChannel, config }]);
```

A wrongly typed value makes `create` throw `GatewayConfigurationError` (prefix `gateway-buzz`) with code `invalid_config`.
