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

## Sender key

By default `sender.id` is the sender's UUID (the number when signal-cli sends no UUID). Pass
`senderKey: "number"` to use the phone number instead (the UUID when the sender hides their
number), so an app that lists owners as `+5511...` matches them. `signal.sourceNumber` and
`signal.sourceUuid` stay set either way, and a DM's `channel.id` still uses the number. Any
other value throws a `ConfigurationError` with code `invalid_config`. Matching owners stays in
your app.

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

## Live verification status

2026-11-05: no real-account send/receive run was performed in the factory sandbox:
`signal-cli` and a registered Signal account were unavailable. Offline tests cover
receive normalization, outbound JSON-RPC, and replying through `deliver()`; they
are not evidence of TheoClaw or real-account operation.

To verify with an account, run the GatewayRunner example above using a registered
or linked number, send it a unique message from a second account, and confirm the
reply on that device. Record the UTC date, signal-cli version, and redacted
send/receive outcome here after performing that check.

## Channel descriptor

`signalChannel` describes the channel as data for `createChannels` and `configFromEnv` from `@theokit/gateway` (transport `socket`; no field is secret).

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { signalChannel } from "@theokit/gateway-signal";

const { config, missing } = configFromEnv(signalChannel, process.env, "APP_");
// Pass the same prefix as `envPrefix`: a missing `account` is then rejected as
// `missing_required_config` naming `APP_SIGNAL_ACCOUNT`.
const { adapters, rejected } = createChannels([
  { descriptor: signalChannel, config, envPrefix: "APP_" },
]);
if (missing.length > 0) console.error(`skipped: set ${missing.join(", ")}`); // APP_SIGNAL_ACCOUNT
```

| Key | Variable | Required |
| --- | --- | --- |
| `account` | `SIGNAL_ACCOUNT` | yes |
| `signalCliPath` | `SIGNAL_CLI_PATH` | no |
| `configDir` | `SIGNAL_CONFIG_DIR` | no |
| `connectTimeoutMs` | `SIGNAL_CONNECT_TIMEOUT_MS` | no |
| `requestTimeoutMs` | `SIGNAL_REQUEST_TIMEOUT_MS` | no |
| `senderKey` | `SIGNAL_SENDER_KEY` | no |

Numbers accept a number or a digit string. `account` must be in E.164 form.
