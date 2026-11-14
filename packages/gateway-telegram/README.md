# @theokit/gateway-telegram

Telegram platform adapter for `@theokit/gateway`. Wraps [grammy](https://grammy.dev/) in the `BasePlatformAdapter` contract.

> **Status: 0.1.0 — pre-release.**


## How inbound arrives

**Long polling by default.** grammY pulls updates and they reach `onInbound` once `connect()`
resolves.

**Webhook.** Telegram also supports a webhook, and `theokit/server/webhook` exports `telegram()` for
the secret token it sends in `X-Telegram-Bot-Api-Secret-Token`. Set `inbound: "webhook"` so
`connect()` checks the token but does not start long polling (a bot with a webhook set cannot call
`getUpdates`), and `disconnect()` does not stop a poller. Parsed updates go to `adapter.deliver(event)`.

```typescript
const adapter = new TelegramAdapter({ token: process.env.TELEGRAM_BOT_TOKEN!, inbound: "webhook" });
// In your webhook route, after verifying the secret token:
await adapter.deliver(event);
```

## Install

```bash
pnpm add @theokit/gateway-telegram @theokit/gateway @theokit/sdk grammy
```

`grammy` is a peer dep — install the version your bot needs.

## Usage

```typescript
import { GatewayRunner } from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";

const adapter = new TelegramAdapter({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  allowedUsers: ["7528967933"], // optional
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`got: ${event.text}`);
  },
});

await runner.start();
```

## Sending an image

`ctx.reply(text, { attachments })` sends each image through `sendPhoto`, one request per image, in
order, and the adapter reports `supportsAttachments` as `true`. The text becomes the first photo's
caption when it is 1 to 1024 UTF-16 units long, Telegram's caption limit. A longer text gets no
caption and is sent after the last photo, split as any text send is, in the same topic and without
the reply target, so none of it is cut. An empty text sends the photos alone.

Every attachment is checked before the first request: an `attachments` value that is not a list,
more than 10 images, or an image with no bytes or over 10 MiB (Telegram's photo limit) is refused
as `invalid_attachment`, and a `kind` other than `image` as `attachments_unsupported`, with no
request. On success the returned `messageId` is the last message sent. A photo Telegram refuses
ends the send with the mapped error and no `messageId`, and the photos before it stay delivered,
so retrying the whole send after a `rate_limited` or `network_error` sends those photos again.
An edit carrying attachments is refused as `attachments_unsupported`.

## Voice notes

**Reading.** A voice note that arrives by polling reaches the handler with `event.audio` set: the
adapter calls `getFile` for its path and downloads it from Telegram's file server with the bot
token. The download is bounded at 20 MiB (Telegram's `getFile` limit; a voice whose declared
`file_size` is larger is not fetched at all), and the whole read, `getFile` and download with its
body, at 30 seconds. `mediaType` is the
voice's `mime_type`, `audio/ogg` when it has none, and `durationSeconds` its `duration`, 0 when it
is not a number. A blocked sender or a message without a voice triggers no request. A voice that
cannot be read (`getFile` fails, the download answers an error status, times out, passes 20 MiB,
or the voice has no `file_id`) is delivered without `audio`, as before this release, with one
stderr line `[telegram] voice not read: <reason>`; the line never carries the download URL, which
holds the token. A voice delivered through a webhook (`parseInbound`) is not read.

**Sending.** An attachment with `kind: "audio"` goes out through `sendVoice`, in the same path and
order as images: the text is the caption of the first attachment whatever its kind, under the
same 1024-unit rule, and an audio-only reply with empty text sends the clip alone. Audio must have
bytes, be at most 50 MiB (the Bot API upload limit) and declare an `audio/*` media type (any case,
parameters allowed), or the send is refused as `invalid_attachment` before any request. Telegram
shows OGG/Opus, MP3 and M4A as a voice bubble; other audio is delivered as a file.

Attachments need `@theokit/gateway` 0.13.0 or later: an older core's `ctx.reply` does not carry
them to the adapter, so install both together.

## Group messages: `requireMention`

With `requireMention: true`, a group or supergroup message reaches the handler only if it mentions
the bot (`@username`, any case), replies to one of the bot's messages, or starts with `/`. Private
chats always pass. The gate applies to polled updates and to events given to `deliver()` (webhook).
It uses the identity grammy holds after `connect()`; a group message that arrives before it is
known is dropped with one stderr line. The default is `false` here, so existing bots keep
answering every message (the other adapters default to `true`). In `telegramChannel` config,
`requireMention` must be a boolean.

## Channel descriptor

`telegramChannel` describes this channel as data, for `createChannels` in `@theokit/gateway`:
a `socket` channel (long polling, no webhook route) whose config has a required, secret `token`
and an optional `allowedUsers`.

```typescript
import { createChannels } from "@theokit/gateway";
import { telegramChannel } from "@theokit/gateway-telegram";

const { adapters, rejected } = createChannels([
  { descriptor: telegramChannel, config: { token: process.env.TELEGRAM_BOT_TOKEN } },
]);
```

Through `createChannels`, an absent or empty token is caught before `create` runs, as a core
`GatewayConfigurationError` coded `missing_required_config`. `telegramChannel.create` itself
refuses a token that is not a string or is empty, and an `allowedUsers` that is not an array of
strings, with this package's `ConfigurationError` (also a `GatewayConfigurationError`), so
`createChannels` lists that channel in `rejected` too.

## Capabilities

`adapter.capabilities` reports `edit`, `typing` and `reactions` as `true` and
`attachments: ["image", "audio"]`. See `@theokit/gateway` for the field meanings.

## Helpers

- `shouldRespondInChat(ctx, policy)` — group-chat policy (DM = always reply, group = only on `@mention` or reply-to-bot or slash command). Register as a `pre_inbound` hook.
- `splitForTelegram(text)` — auto-splits text >4096 chars across multiple `sendMessage` calls.

## Platform escape hatch

For Telegram features not portable across platforms (voice transcription, photo OCR, sticker handling), use `event.telegram?.raw` to access the underlying grammy `Context`:

```typescript
runner.onInbound(async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as import("grammy").Context;
  if (ctx.message?.voice) { /* ... */ }
});
```

## License

Apache-2.0
