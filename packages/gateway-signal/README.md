# @theokit/gateway-signal

Signal platform adapter for [`@theokit/gateway`](../gateway).

It drives [signal-cli](https://github.com/AsamK/signal-cli) in JSON-RPC mode
(`signal-cli -a <account> jsonRpc`) over the child process's stdio. signal-cli keeps the
account's keys in its own data directory, so the adapter holds no secret, and the package has
no runtime dependencies.

## How inbound arrives

**A child process.** The adapter starts one signal-cli, and every `receive` notification it
prints becomes a `SignalMessageEvent`. There is no webhook to host. Envelopes without message
text (receipts, typing notices) produce no event.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-signal
```

signal-cli must be on `PATH` (or passed as `signalCliPath`), with the account already
registered or linked to it.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { SignalAdapter } from "@theokit/gateway-signal";

const adapter = new SignalAdapter({ account: "+5511999990000" });

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`, { format: "markdown" });
  },
});
await runner.start();
```

`connect()` returns `true` only once signal-cli answers a `listGroups` request, and `false`
(never a throw) when the binary is missing, the account is not registered, or nothing answers
within `connectTimeoutMs` (10 s by default).

## Channels

- A direct message has `channel.id` set to the sender's number (or UUID when the number is
  hidden) and `channel.type` `"dm"`.
- A group message has `channel.id` `"group.<groupId>"` and `channel.type` `"group"`; a reply to
  that id goes to the group.

## Formatting

Signal has no markdown mode. With `format: "markdown"`, the adapter removes the markers of
`**bold**`, `*italic*`/`_italic_`, `~~strike~~` and `` `code` `` and sends them as Signal text
styles, so the reader sees the emphasis and no asterisks. `toTextStyle` is exported for callers
that want the same conversion.

## Send results

| Outcome | `error.code` |
|---|---|
| empty text | `empty_text` |
| `connect()` has not succeeded | `not_connected` |
| signal-cli answered a JSON-RPC error | `signal_rpc_error` |
| no answer within `requestTimeoutMs` (30 s) | `timeout` |
| signal-cli ended or `disconnect()` ran while the send was pending | `disconnected` |

A successful send returns the Signal timestamp of the message as `messageId`.
