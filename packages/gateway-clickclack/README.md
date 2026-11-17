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

## Capabilities

`adapter.capabilities` reports `maxMessageChars` is the splitter's limit (exported from this package) and `threads` is `false`; other fields follow the defaults of `@theokit/gateway`.

## Channel descriptor

`clickclackChannel` describes this channel as data for `createChannels` and `configFromEnv` in
`@theokit/gateway`: a `socket` channel (the adapter opens its own realtime connection).

| Config key | Environment variable | Required | Secret |
| --- | --- | --- | --- |
| `baseUrl` | `CLICKCLACK_BASE_URL` | yes | no |
| `token` | `CLICKCLACK_TOKEN` | yes | yes |
| `workspaceId` | `CLICKCLACK_WORKSPACE_ID` | yes | no |
| `botUserId` | `CLICKCLACK_BOT_USER_ID` | yes | no |
| `reconnectDelayMs` | `CLICKCLACK_RECONNECT_DELAY_MS` | no | no |

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { clickclackChannel } from "@theokit/gateway-clickclack";

const { config, missing, secrets } = configFromEnv(clickclackChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([{ descriptor: clickclackChannel, config }]);
```

A wrongly typed value makes `create` throw `ConfigurationError` with code `invalid_config`.
