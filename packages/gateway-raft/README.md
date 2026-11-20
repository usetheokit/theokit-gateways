# @theokit/gateway-raft

Raft **External Agent** platform adapter for [`@theokit/gateway`](../gateway), over the Raft CLI
wake bridge. The adapter runs `raft wake --json` and turns each JSON line it prints into a
message; a reply runs `raft reply --to <conversation>` with the text on stdin. The CLI keeps its
own Raft login, so the adapter holds no secret.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { RaftAdapter } from "@theokit/gateway-raft";

const runner = new GatewayRunner({
  adapters: [new RaftAdapter()],
  handler: async (_event, ctx) => ctx.reply("hello from the agent"),
});
await runner.start();
```

## Wire contract (assumed)

No public Raft CLI specification was available, so the contract below is an assumption; override
`command`, `wakeArgs` and `replyArgs` to match your CLI.

- Wake: one JSON object per stdout line, `{"id": "...", "from": "...", "text": "...",
  "conversation": "...", "ts": 1700000000000}`. `conversation` defaults to `from`; `ts` is epoch
  milliseconds and optional. Lines that are not usable wakes, and repeated ids, are dropped.
- Reply: exit code 0 means delivered; anything else is `raft_send_failed` with the CLI's stderr.
  The result carries no message id.
- Text only: markdown loses its markers; attachments are refused with `attachments_unsupported`.
- If the wake child exits, the adapter is disconnected until `connect()` is called again.

## Status

Unverified: no wake-and-reply run against a real Raft account has been recorded. The live suite
needs the Raft CLI, a logged-in account and someone to wake the agent.

## Channel descriptor

`raftChannel` describes the channel as data for `createChannels` and `configFromEnv` from `@theokit/gateway` (transport `socket`; no field is secret).

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { raftChannel } from "@theokit/gateway-raft";

const { config } = configFromEnv(raftChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([{ descriptor: raftChannel, config }]);
```

| Key | Variable | Required |
| --- | --- | --- |
| `command` | `RAFT_COMMAND` | no |
| `wakeArgs` | `RAFT_WAKE_ARGS` (comma-separated) | no |
| `replyTimeoutMs` | `RAFT_REPLY_TIMEOUT_MS` | no |

Numbers accept a number or a digit string. `replyArgs` and `spawn` are code seams and cannot be set from the environment.
