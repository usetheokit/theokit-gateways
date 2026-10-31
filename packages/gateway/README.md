# @theokit/gateway

Multi-platform messaging gateway for `@theokit/sdk`. Transport-agnostic primitives — adapters live in separate peer-dep packages.

> **Status: 0.1.0 — pre-release.** Breaking changes allowed within the `0.x` line per semver.

## Install

```bash
pnpm add @theokit/gateway @theokit/sdk
# Plus one or more transport adapters:
pnpm add @theokit/gateway-telegram grammy
pnpm add @theokit/gateway-discord discord.js
```


## How each adapter treats `OutboundMessage.format`

**Every adapter honours it** — each reads the field and lets it decide what the platform receives. What they can DO with it differs by platform, and a consumer should not have
to read every package to learn which — so the classes are stated here.

| Platform | What it does with `format` |
|---|---|
| telegram | sets `parse_mode` |
| slack | sets `mrkdwn` |
| matrix | `html` only: sends `formatted_body` + `format: org.matrix.custom.html`, retrying as plain text if the homeserver refuses it. **`markdown` is dropped with a warning** — `formatted_body` promises HTML, and putting markdown there renders literal asterisks AND silently eats any `<tag>` in the text |
| teams | sets `textFormat` on the activity |
| email | sends an `html` part **alongside** `text`, never instead of it. `html` passes through verbatim (the caller owns that trust boundary); `markdown` is HTML-escaped into a `<pre>` block, so it is preserved and readable, not parsed |
| discord, mattermost | markdown is native, so `markdown` needs no flag; **`plain` escapes** `*_\`~` so a user's literal asterisks stay literal |
| line, sms, whatsapp | the platform carries no formatting on this message type — the adapter logs once that the declared format was dropped, rather than discarding it in silence |

**What none of them does is convert markdown to a platform's dialect.** `format` states the
caller's INTENT and lets the transport act on it; translating `**bold**` into WhatsApp's
`*bold*` is a presentation concern, and `channelRendering` (below) is where it happens.

Measured 2026-08-30: before this, two of ten read the field. An agent answered
`**Bom Sucesso (MG)**` and LINE and WhatsApp delivered literal asterisks, which is what a
declared-and-ignored field costs at the far end.


## Sending an agent's reply

`@theokit/presenter`'s `ChatPresenter` turns one agent turn into one chat message: it keeps the
answer's text, drops the model's reasoning and the tool events, and emits once, on `finish`.
`channelRendering(platform)` gives it the two things it needs to know about the destination, as
`{ translate, format }`.

```typescript
import { channelRendering, type MessageEvent } from "@theokit/gateway";
import { type AgentOutputEvent, ChatPresenter } from "@theokit/presenter";
import type { TelegramAdapter } from "@theokit/gateway-telegram";

async function reply(
  adapter: TelegramAdapter,
  event: MessageEvent,
  turn: AsyncIterable<AgentOutputEvent>,
): Promise<void> {
  const presenter = new ChatPresenter({
    channel: event.channel,
    ...channelRendering(event.platform),
  });
  for await (const output of turn) {
    for (const message of presenter.present(output)) await adapter.sendMessage(message);
  }
}
```

A hand-written loop that concatenates every event carrying `text` sends the reasoning too: one
reply reached a phone as `"TheOi! 👋"`, `"The"` being the start of the model's thinking. Build one
presenter per turn; it keeps state between `present()` calls.

| Platform | `translate` | `format` |
|---|---|---|
| whatsapp | `**b**` to `*b*`, `*i*` or `_i_` to `_i_`, `~~s~~` to `~s~`, `` `c` `` to ` ```c``` ` | `plain` |
| slack | `**b**` to `*b*`, `*i*` or `_i_` to `_i_`, `~~s~~` to `~s~`, `` `c` `` kept | `markdown` |
| discord, mattermost, teams, signal, nextcloud_talk | unchanged | `markdown` |
| telegram, matrix, email, line, sms, imessage, google_chat, irc, nostr, feishu_lark, synology_chat, tlon_urbit, twitch | the markers removed, their content kept | `plain` |

- Only the four inline markers are translated: bold, italic, strikethrough and inline code.
  Headings, links, lists and block quotes reach every platform unchanged.
- **Fenced code blocks are not handled yet, and they come out wrong.** The inline-code rule
  rewrites a fence's backticks: a three-backtick fence becomes one backtick on the plain
  platforms and seven on whatsapp. Do not send a fenced block to a platform that does not render
  markdown.
- Telegram gets plain text on purpose. Its adapter maps `markdown` to legacy Markdown, which
  refuses a reply with an unpaired `_` or `*`, and the send fails with no retry.
- These renderings are inferred from each platform's documented syntax and from what each adapter
  does with `format`; none was observed on a real client.
- The presenter never splits. Each adapter's `sendMessage` splits a long message at its own
  platform's limit, as it always has.
- `channelRendering` throws a `RangeError` for a platform it does not know, rather than letting
  the presenter fall back to markdown.
- `@theokit/presenter` is your dependency, not this package's: `@theokit/gateway` does not depend
  on it.

## Sending an image

`ctx.reply` takes an optional `attachments` list of images, each an `OutboundAttachment`: its
bytes (`data`, a `Uint8Array`), their `mediaType`, and an optional `filename`. The runner carries
the list to the adapter's `sendMessage` as `OutboundMessage.attachments`, by reference, and leaves
an empty list out. `post_outbound` hooks see the same outbound, image bytes included. Do not change
the bytes or the list until the reply's promise settles: Telegram reads each image only when its
turn comes. `DeliveryRouter.send` takes the same `attachments` field for a scheduled delivery.

Only Telegram sends images today. Code that holds the adapter reads `supportsAttachments` before
attaching: every other adapter reports `false` and refuses an outbound carrying attachments with
`attachments_unsupported`, making no platform call, so an image is never dropped in silence. An
edit carrying attachments is refused the same way on every adapter, Telegram included.
`BasePlatformAdapter`, `OutboundAttachment` and `SendResult` come from `@theokit/gateway`.

```typescript
async function sendChart(
  adapter: BasePlatformAdapter,
  channel: OutboundMessage["channel"],
  chart: OutboundAttachment,
): Promise<SendResult> {
  // No image send on this platform: say so in text instead.
  if (!adapter.supportsAttachments) {
    const text = "The chart is ready, but this chat cannot show images.";
    return adapter.sendMessage({ channel, text });
  }
  return adapter.sendMessage({ channel, text: "Here is the chart.", attachments: [chart] });
}
```

The runner and the router answer `attachments_unsupported` themselves, with no `sendMessage` call,
when the adapter does not declare `supportsAttachments`, so an adapter that ignores the field
cannot drop the image and report success. A handler, which receives no adapter, branches on that
code:

```typescript
const sent = await ctx.reply("Here is the chart.", { attachments: [chart] });
if (sent.error?.code === "attachments_unsupported") {
  await ctx.reply("The chart is ready, but this chat cannot show images.");
}
```

| Code | When |
|---|---|
| `attachments_unsupported` | the adapter cannot send attachments, the outbound is an edit, or (Telegram) an attachment's `kind` is not `image` |
| `invalid_attachment` | Telegram only: `attachments` is not a list, holds more than 10 images, or an image has no bytes or is over 10 MiB |

## Editing a sent message

Six adapters can replace the text of a message they sent, keeping its id: Telegram, Discord,
Slack, Mattermost, Matrix and Teams. E-mail, SMS, LINE and WhatsApp cannot, because their
platforms have no edit call. A caller that wants a reply to appear as a preview and then become
the final text reads `supportsEdit` before it starts, and falls back to `sendMessage` whenever an
edit is refused. `BasePlatformAdapter`, `OutboundMessage` and `SendResult` come from
`@theokit/gateway`.

```typescript
async function sendWithPreview(
  adapter: BasePlatformAdapter,
  out: OutboundMessage,
  preview: string,
): Promise<SendResult> {
  // No edit call on this platform: send the final text once.
  if (!adapter.supportsEdit) return adapter.sendMessage(out);
  const sent = await adapter.sendMessage({ ...out, text: preview });
  if (!sent.ok || sent.messageId === undefined) return adapter.sendMessage(out);
  // The preview must fit one message; edit_too_long and every other refusal fall back to a send.
  const edited = await adapter.editMessage(sent.messageId, out);
  return edited.ok ? edited : adapter.sendMessage(out);
}
```

`supportsEdit` is set at construction and does not change with `connect()`. `editMessage` never
throws on a platform error; it answers with a `SendResult`, and these refusals make no edit
request:

| Code | When |
|---|---|
| `edit_unsupported` | the adapter cannot edit (the four above), or a Matrix client injected without `sendMessage` |
| `edit_too_long` | the text would need more than one platform message, counted after a `plain` text is escaped as a send escapes it; an edit replaces one message and is never split. Matrix has no length check |
| `invalid_message_id` | the id is empty, or on Telegram not a positive integer |
| `empty_text` | the text is empty, or on Teams only whitespace |
| `not_connected` | the adapter is not connected, where its `sendMessage` checks that too (all but Telegram and Discord) |
| `invalid_channel` | Telegram only: the channel id is not numeric, as on a send |
| `encrypted_room_unsupported` | Matrix only: the room is encrypted, as on a send |

Any other refusal comes from the platform, mapped as `sendMessage` maps it. Keep the preview
within one message, and edit only a message this adapter sent: on Matrix an edit is an
`m.replace` event, and clients apply it only to an event from the same sender. An edit whose
markup the platform refuses is not retried as plain text. When an edit is refused, the sample
sends the final text as a new message, so the preview stays above it.

`supportsEdit` says that the adapter has an edit call, not that every edit is accepted. Treat
`edit_unsupported` from an adapter that reports `true` as "stop previewing", like any other
refusal. Where an adapter checks the connection, `not_connected` is answered before
`invalid_message_id`.

The adapters do not order edits. Two edits of the same message that are in flight at once can
reach the platform in either order, and the one that lands last stays on screen; on Matrix each
edit is a separate event and clients show the newest. Await each edit before sending the next,
or keep one in flight and send only the latest text when it settles.

## Architecture (5 pieces)

| Module | Responsibility |
|---|---|
| `BasePlatformAdapter` | Contract every adapter implements: `connect`, `disconnect`, `sendMessage`, `onInbound` |
| `GatewayRunner` | Orchestrator: holds adapters, dispatches inbound events to your handler |
| `SessionRouter` | Pure function: `MessageEvent → agentId` (composes `Agent.resume`, ADR D174) |
| `DeliveryRouter` | Dispatch outbound messages (composes `Cron`, ADR D175) |
| `HookExecutor` | `pre_inbound` / `post_outbound` / `on_error` hooks (own contract, ADR D176) |

## Minimal example

```typescript
import { Agent } from "@theokit/sdk";
import { GatewayRunner, SessionRouter } from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";

const router = new SessionRouter();
const adapter = new TelegramAdapter({ token: process.env.TELEGRAM_BOT_TOKEN! });

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    const agent = await Agent.resume(router.resolveAgentId(event), {
      apiKey: process.env.OPENROUTER_API_KEY!,
      model: { id: "openai/gpt-4o-mini" },
    });
    const run = await agent.send(event.text);
    const result = await run.wait();
    await ctx.reply(result.result ?? "no reply");
    await agent.dispose();
  },
});

await runner.start();
```

## Wiring channels from descriptors

Each platform package that has one exports a descriptor: a static object listing the channel's
config fields (`required`, `secret`), how to build its adapter (`create`), and, for a channel that
receives webhooks, how to verify and ingest a request (`webhook`). `createChannels` builds every
channel from its descriptor without connecting anything, and `connectFailure: "isolate"` keeps the
channels that connect when another one cannot.

```typescript
import { createChannels, GatewayRunner } from "@theokit/gateway";
import { lineChannel } from "@theokit/gateway-line";
import { telegramChannel } from "@theokit/gateway-telegram";

const { adapters, rejected } = createChannels([
  { descriptor: telegramChannel, config: { token: process.env.TELEGRAM_BOT_TOKEN } },
  {
    descriptor: lineChannel,
    config: {
      channelSecret: process.env.LINE_CHANNEL_SECRET,
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    },
  },
]);
for (const { platform, error } of rejected) console.error(`${platform}: ${error.message}`);

const runner = new GatewayRunner({
  adapters,
  connectFailure: "isolate",
  handler: async (event, ctx) => {
    await ctx.reply(`got: ${event.text}`);
  },
});

const { connected, failed } = await runner.start();
if (connected.length === 0) throw new Error("no channel connected");
for (const { platform, reason } of failed) console.error(`${platform} did not connect: ${reason}`);
```

- `createChannels` rejects an entry whose required field is absent, `null` or `""` with a
  `GatewayConfigurationError` coded `missing_required_config` that names the keys, and reports a
  configuration error thrown by `create` the same way. Any other error propagates. It performs no
  network call.
- `connectFailure` defaults to `"rollback"`: one failed connect disconnects the adapters that did
  connect and rejects `start()`, as before. Under `"isolate"`, `start()` resolves even when every
  adapter failed, so check `connected` before you rely on the runner.
- `start()` resolves a `StartResult` (`{ connected, failed }`) under both values. Code that awaits
  it and ignores the value is unaffected; a type or subclass that declares
  `start(): Promise<void>` needs to change.
- A runner holds one channel per platform: it routes replies and `stop()` by platform.
  `createChannels` enforces this. The first entry built for a platform wins, and a later entry for
  it is rejected with a `GatewayConfigurationError` coded `duplicate_channel` and never built. An
  entry whose `create` returns an adapter reporting another platform than its descriptor is
  rejected with the code `platform_mismatch`, and that adapter is dropped unconnected. A
  runner you build from adapters you constructed yourself is not checked, so give it one adapter
  per platform: with two of one platform the later one sends the earlier one's replies, and the
  earlier one is connected but never disconnected.
- Under `"isolate"`, and under `"rollback"` until the first failure, `start()` waits for every
  connect, so a connect that never settles blocks it.
- A webhook channel's request reaches your HTTP route; route it by platform to the descriptor's
  `webhook.verify(adapter, { rawBody, headers })`, then parse the body and pass it to
  `webhook.ingest(adapter, payload)`, which answers `"delivered"`, `"malformed"` or
  `"no_handler"`. Answer the platform with a success status only for `"delivered"`.
  `"no_handler"` means the payload held a message and no handler was subscribed: a request that
  arrives before `start()` resolves, after `stop()`, or for a channel `start()` reported in
  `failed` under `"isolate"`. Acknowledging it loses the message, since the platform does not
  redeliver an acknowledged request.

## Receiving from a TheoKit app

Three repositories share this path. `theokit` owns the HTTP route and the signature check —
`handleChannelWebhook` verifies the signature, parses the body, and hands your app the parsed JSON
as `payload: unknown`. These packages own the translation. `theokit-sdk` is used here for one thing
today: redacting a throw before it reaches a log, at two call sites.

```ts
import { parseInbound } from "@theokit/gateway-telegram";

// Inside onMessage. The signature and the JSON parse already happened.
const event = parseInbound(message.payload);
if (event !== null) {
  console.log(`${event.platform} ${event.channel.id}: ${event.text}`);
}
```

`parseInbound` returns `null` rather than throwing for a body it does not recognise. Measured
against `theokit@0.48.14`: `onMessage` is
awaited **before** the 200 is built, and nothing inside `handleChannelWebhook` catches — so a throw
on an unparseable payload means the 200 is never built. Mounted in a TheoKit route, the rejection
reaches that route's error boundary and is answered **500**: the platform sees a failed delivery
where it expected an acknowledgement.

### WhatsApp, since `theokit@0.60.0`

Until that release this was impossible rather than undocumented: `theokit/server/webhook`
exported no `whatsapp` validator, so the `validators` map could not carry one and the path
answered 404 by construction. Meta's subscribe handshake had no seam at all
([usetheokit/theokit#556](https://github.com/usetheokit/theokit/issues/556), filed from
here). Both halves exist now, and the wiring needs three things that are easy to miss:

```ts
import { handleChannelWebhook } from "theokit/server/agent";
import { route } from "theokit/server/define";
import { whatsapp, whatsappSubscribe } from "theokit/server/webhook";
import { normalizeInboundMessages, parseWebhookPayload } from "@theokit/gateway-whatsapp";

const handle = ({ request }: { request: Request }) =>
  handleChannelWebhook(request, new URL(request.url).pathname, {
    validators: { whatsapp: whatsapp({ appSecret: process.env.META_APP_SECRET! }) },
    subscribe: { whatsapp: whatsappSubscribe({ verifyToken: process.env.META_VERIFY_TOKEN! }) },
    onMessage: async ({ payload }) => {
      const envelope = parseWebhookPayload(payload);
      if (envelope === null) return; // not a shape we know — answer normally
      for (const event of normalizeInboundMessages(envelope)) {
        console.log(`${event.from}: ${event.text}`);
      }
    },
  });

// BOTH verbs, and `.csrf(false)` on each.
export const GET = route().csrf(false).policy("public").handler(handle).build();
export const POST = route().csrf(false).policy("public").handler(handle).build();
```

- **`GET` as well as `POST`.** Meta calls the endpoint once with
  `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` and expects the challenge echoed as
  `text/plain` before it delivers anything. That is what `subscribe` answers. A `GET` on a
  platform that has a validator and no `subscribe` entry is **405**, not 404 — configured, but
  it does not do handshakes.
- **`.csrf(false)` on both.** Without it the route answers `403 CSRF_INVALID: Missing
  X-Theo-Action header` before the signature is ever checked, and Meta will never send that
  header. `policy("public")` answers a different question — may an unauthenticated caller reach
  this — and does not lift the CSRF gate. The HMAC is strictly stronger than the header it
  replaces, and Meta carries no session for a third-party page to ride.
- **`appSecret` is the Meta *app secret*,** not the access token. It accepts an array so a
  rotation can verify against either.

This package also exports `verifyWebhookSignature` and `verifyWebhookSubscription`, which do
the same two jobs. Use theokit's when you are on this seam; ours exist for an app that is not,
and they are what `gateway-sms` uses through its own `createWebhookServer`.

Not verified here: the `theokit` behaviour above was measured by the session that shipped
0.60.0, driving a scaffolded app over HTTP. What this repository checked is narrower and
stated as such — that `theokit@0.60.0` does export `whatsapp` and `whatsappSubscribe` from
`theokit/server/webhook`, that `route` lives on `theokit/server/define` rather than on the
`theokit/server` umbrella that warns it is deprecated, and that `parseWebhookPayload` takes the
`unknown` payload `onMessage` hands over. A real delivery from Meta needs an approved app and a public URL, and
has not happened on either side.

`parseInbound` under that name exists on `@theokit/gateway-telegram` and `@theokit/gateway-sms`,
with different arguments: SMS takes `(options, ctx)` because the `SignatureContext` it needs carries
the raw body, the headers and the URL, and `ChannelMessage` provides none of the three — so it is wired through its
own `createWebhookServer` rather than this seam.
Every other adapter exports its translation under its own name — `gateway-line` has
`lineEventToMessageEvent`, `gateway-whatsapp` composes `parseWebhookPayload` with
`normalizeInboundMessages` — each with its own signature: read the one you are using rather than
assuming this one's.

Adapters whose transport is a long-lived connection rather than a webhook own that transport and do
not go through this seam.

## Design principles

- **Compose, don't reimplement.** The gateway never owns session persistence (SDK does), never owns scheduling (Cron does), never owns prompt resolution (SystemPromptResolver does).
- **Adapters are peer-dep packages.** Install only the transports you need.
- **Hooks live in the gateway, not the SDK.** Transport-layer concerns shouldn't pollute the SDK's Plugin contract.

See `.claude/knowledge-base/adrs/D170-D181-*.md` for the full design rationale.

## License

Apache-2.0
