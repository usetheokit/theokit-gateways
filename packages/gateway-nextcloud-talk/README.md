# @theokit/gateway-nextcloud-talk

Nextcloud Talk platform adapter for [`@theokit/gateway`](../gateway).

It runs as a Talk **bot**: Talk posts every message in the bot's rooms to a webhook, signed with
the bot's secret, and the bot answers through Talk's bot endpoint with a message it signs the
same way. The package has no runtime dependencies; the webhook route uses the `express` peer.

## How inbound arrives

**Webhook.** The adapter serves `POST /nextcloud-talk` (port 3000 by default, or on your own
Express app passed as `app`, which you then `listen` on). Every webhook adapter in this family
defaults to 3000, so two of them in one process need distinct `port` values or one shared `app`.
A body over 1 MiB is refused with 413 and `{"error":"request body too large"}`. Talk must reach
that URL; a Talk server in Docker reaches the host as `host.docker.internal`, and Nextcloud
refuses a bot URL on a private address until `allow_local_remote_servers` is set.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-nextcloud-talk express
```

## Set up the bot

On the Nextcloud server, install the bot with a secret of 40 to 128 characters and attach it to
a room:

```bash
occ talk:bot:install --feature webhook --feature response theo "$TALK_BOT_SECRET" https://bot.example.com/nextcloud-talk
occ talk:bot:setup <bot id> <room token>
```

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { NextcloudTalkAdapter } from "@theokit/gateway-nextcloud-talk";

const adapter = new NextcloudTalkAdapter({
  baseUrl: "https://cloud.example.com",
  secret: process.env.TALK_BOT_SECRET ?? "",
  port: 3000,
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`);
  },
});
await runner.start();
```

`connect()` reads `<baseUrl>/ocs/v2.php/cloud/capabilities`, requires Talk's `bots-v1` feature
and starts the webhook listener. It returns `false`, never a throw, when the server cannot be
read, lacks the feature, or does not answer within `connectTimeoutMs` (10 s by default; the
pending read is aborted), or when the port is held by another listener. A `connect()` made while
another is pending shares its answer; a `disconnect()` made while one is pending wins, that
connect answers `false` and leaves no listener, and the next `connect()` starts a fresh session.
The constructor throws when `secret` is not 40 to 128 characters, the
range `occ talk:bot:install` accepts: an empty secret would let anyone sign a webhook.

## Inbound

- A webhook is accepted only when `x-nextcloud-talk-signature` is the hex HMAC-SHA256 of
  `x-nextcloud-talk-random` followed by the raw body, under the bot secret, compared in constant
  time. A missing header or a mismatch answers 401 and calls no handler. `verifyTalkSignature` is
  exported.
- A `Create` from a `Person` becomes a `NextcloudTalkMessageEvent`: `id` is the message id,
  `channel` is `{ id: <room token>, type: "group" }`, `text` is the message, and
  `nextcloud_talk.replyToId` names the message it answers, when it answers one.
- A `Join`, a message from a bot or another application, and a body whose `content` is not
  Talk's JSON give no event (the last logs one line). All answer 200.

## Formatting

Talk renders markdown, so `format: "markdown"` is sent as is. `format: "html"` is sent unchanged
and logs one warning per adapter.

## Send results

`sendMessage` posts to `<baseUrl>/ocs/v2.php/apps/spreed/api/v1/bot/<room token>/message` with a
fresh 64-hex random and the signature of that random followed by the text. A text longer than
32000 code points, Talk's limit, goes as consecutive messages; `splitForTalk` is exported. The
first refused part stops the rest, and its error message starts with `part <k> of <n>`, since the
parts before it are already in the room.

| Result | When |
| --- | --- |
| `{ ok: true, messageId }` | Talk answered 201. `messageId` is the `referenceId` the adapter sent with the first message. |
| `talk_unauthorized` | 401: the signature does not match the installed bot's secret |
| `talk_bad_request` | 400: the room does not exist, or the bot is not attached to it |
| `talk_http_error` | any other status, or the request failed |
| `invalid_room` | `channel.id` is not a room token (letters and digits only) |
| `empty_text` | the text is empty |
| `not_connected` | `connect()` has not succeeded |
