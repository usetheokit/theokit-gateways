# @theokit/gateway-imessage

iMessage platform adapter for [`@theokit/gateway`](../gateway).

It drives [`imsg`](https://github.com/openclaw/imsg) in JSON-RPC mode (`imsg rpc`) over the
child process's stdio. `imsg` reads the Messages database and sends through Messages on a Mac
that is signed in to iMessage, so the adapter holds no secret, and the package has no runtime
dependencies.

## Where it runs

`imsg` only sends and receives on macOS, signed in to Messages, with the permissions its own
README lists (Full Disk Access for the database). On Linux the gateway can still reach a Mac by
passing an ssh wrapper script as `cliPath`, a script that runs `imsg rpc` on the Mac and pipes
its stdio back.

## How inbound arrives

**A child process.** The adapter starts one `imsg rpc` and subscribes to new messages with
`watch.subscribe`. Every `message` notification with text, sent by someone other than the
signed-in account, becomes an `IMessageMessageEvent`. Messages the account sent itself,
including the adapter's own replies, are dropped, so a reply never loops back to the handler.

Rows are handed to the `onInbound` handler one at a time, in row order, and the adapter waits
for each call to return before the next. After `imsg` restarts, the adapter subscribes with
`since_rowid` set to the last row whose handler call returned. A row that arrives before any
handler is registered does not move that cursor, so the next subscription asks for it again.

Under `GatewayRunner` the handler call returns once the runner has dispatched the event, not
when your own handler finishes, so the cursor there means "dispatched". A row is delivered at
most once per adapter instance; the cursor lives in memory and starts over with a new instance.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-imessage
```

`imsg` must be on `PATH` (or passed as `cliPath`).

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { IMessageAdapter } from "@theokit/gateway-imessage";

const adapter = new IMessageAdapter({});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`);
  },
});
await runner.start();
```

`connect()` returns `true` only once `imsg` answers `watch.subscribe`, and `false` (never a
throw) when the binary is missing, `imsg` cannot read the database, or nothing answers within
`connectTimeoutMs` (10 s by default).

## Channels

`channel.id` is `imsg`'s numeric chat id as a decimal string, and `channel.type` is `"group"`
for a group chat and `"dm"` otherwise. A reply goes to that chat id.

## Formatting

Messages shows text as typed. With `format: "markdown"` the adapter removes the markers
(`**`, `_`, `~~`, `` ` ``) so the reader sees no asterisks; `html` is sent unchanged, with one
warning per adapter.

## Send results

The adapter never retries a send: each `imsg` error keeps its meaning.

| Outcome | `error.code` |
|---|---|
| empty text | `empty_text` |
| channel id is not a positive integer | `invalid_chat_id` |
| `connect()` has not succeeded | `not_connected` |
| `imsg` could not confirm the send (`-32001`); it may have been delivered | `imsg_outcome_uncertain` |
| `imsg` did not start the send (for example, no such chat); safe to retry | `imsg_not_sent` |
| `imsg`'s send lane is blocked (`-32004`); the adapter ends the child, so call `connect()` again | `imsg_send_lane_blocked` |
| any other `imsg` error | `imsg_error` |
| no answer within `requestTimeoutMs` (30 s) | `timeout` |
| `imsg` ended or `disconnect()` ran while the send was pending | `transport_closed` |

A successful send returns the message's guid as `messageId`, or `imsg`'s numeric row id when
there is no guid. When `imsg` answers with neither, `messageId` is absent.
