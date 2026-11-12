# @theokit/gateway-x

X (Twitter) platform adapter for [`@theokit/gateway`](../gateway). Mentions of the bot account are
polled from the X API v2 and become group-thread conversations, with the tweets they reply to and
the tweet they quote. Replies are public replies. No DMs, likes or media uploads.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { XAdapter } from "@theokit/gateway-x";

const adapter = new XAdapter({
  userId: process.env.X_USER_ID!,
  username: process.env.X_USERNAME!,
  clientId: process.env.X_CLIENT_ID!,
  clientSecret: process.env.X_CLIENT_SECRET!,
  refreshToken: process.env.X_REFRESH_TOKEN!,
  allowFrom: ["alice"], // handles or user ids; everyone else gets no reply
  guest: { dailyLimit: 3 }, // optional: other authors, per author per UTC day
  onRefreshToken: (token) => saveSomewhere(token), // X rotates it on every refresh
});
const runner = new GatewayRunner({ adapters: [adapter], handler: async (_e, ctx) => ctx.reply("hello") });
await runner.start();
```

## Behaviour

- **Auth**: an OAuth 2.0 confidential app. The refresh token (scopes `tweet.read tweet.write
  users.read offline.access`) is exchanged for an access token; X issues a new refresh token each
  time, handed to `onRefreshToken`. `bearerToken` may read mentions instead.
- **Inbound**: `connect()` notes the newest existing mention, so the backlog is not answered. Then
  mentions are polled every `pollIntervalMs` (default 60 s; `0` leaves it to `poll()`). The event's
  channel is the conversation id (`group`); `event.x.thread` holds up to `maxThreadDepth` (5)
  ancestors, oldest first, and `event.x.quoted` the quoted tweet. Leading handles are removed from
  `text`.
- **Who is answered**: only `allowFrom` authors. A mention from anyone else produces no event and
  no reply, unless `guest` is set, which answers each other author up to `dailyLimit` times per
  UTC day (`event.x.guest` is `true`).
- **Outbound**: a reply is a public reply to the latest mention of the conversation (or `replyTo`,
  when it is a delivered mention), split at 280 characters into a chain. Attachments are refused
  (`attachments_unsupported`).

Status: unverified against the live X API; wire shapes are written from X's public docs.
