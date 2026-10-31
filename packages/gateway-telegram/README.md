# @theokit/gateway-telegram

Telegram platform adapter for `@theokit/gateway`. Wraps [grammy](https://grammy.dev/) in the `BasePlatformAdapter` contract.

> **Status: 0.1.0 — pre-release.**


## How inbound arrives

**Long polling by default.** grammY pulls updates and they reach `onInbound` once `connect()`
resolves.

Telegram also supports a webhook, and `theokit/server/webhook` exports `telegram()` for the secret
token it sends in `X-Telegram-Bot-Api-Secret-Token`. Parsed updates go to `adapter.deliver(event)`.
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
or an image with no bytes, is refused as `invalid_attachment`, and a `kind` other than `image` as
`attachments_unsupported`, with no request. A photo Telegram refuses ends the send with the mapped
error, and the photos before it stay delivered; the returned `messageId` is the last message sent.
An edit carrying attachments is refused as `attachments_unsupported`.

Attachments need `@theokit/gateway` 0.13.0 or later: an older core's `ctx.reply` does not carry
them to the adapter, so install both together.

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
