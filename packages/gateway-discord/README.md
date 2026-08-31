# @theokit/gateway-discord

Discord platform adapter for `@theokit/gateway`. Wraps [discord.js](https://discord.js.org/) in the `BasePlatformAdapter` contract.

> **Status: 0.1.0 — pre-release.**


## How inbound arrives

**Gateway WebSocket.** discord.js holds the connection; events reach `onInbound` once `connect()`
resolves. There is no webhook to host and nothing for an application to authenticate.
## Install

```bash
pnpm add @theokit/gateway-discord @theokit/gateway @theokit/sdk discord.js
```

## Usage

```typescript
import { GatewayRunner } from "@theokit/gateway";
import { DiscordAdapter } from "@theokit/gateway-discord";

const adapter = new DiscordAdapter({
  token: process.env.DISCORD_BOT_TOKEN!,
  // intents defaults to [Guilds, GuildMessages, MessageContent,
  // DirectMessages, DirectMessageReactions]. Without MessageContent
  // the bot receives empty msg.content — silent failure (EC-C).
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`got: ${event.text}`);
  },
});

await runner.start();
```

## Limitations (v0.1)

- **Text-trigger commands only.** Proper Discord slash commands (registered via Application Commands API) are out of scope — use `event.text.startsWith("!cmd")` for now.
- **WebSocket only** (ADR D179). No webhook-based bot mode.
- **Voice channels** not exposed via `MessageEvent`. Use `event.discord?.raw` for advanced cases.

## Known issue: `@types/node@26` and type-aware lint

If you install `@types/node@26` (the current `latest`) and run **type-aware lint**, or
`tsc` with `skipLibCheck: false`, you will see an error from a package you never
installed:

```
@sapphire/shapeshift/dist/esm/index.d.mts(1,10): error TS2305:
  Module '"util"' has no exported member 'InspectOptionsStylized'.
```

It is not this adapter, and it is not `discord.js` misbehaving. `@types/node@26`
renamed `util.InspectOptionsStylized` to `InspectContext`; `@sapphire/shapeshift@4`
— which `discord.js` pulls through `@discordjs/builders` — still imports the old
name. Measured 2026-08-29:

| `@sapphire/shapeshift` | imports | works on `@types/node` |
|---|---|---|
| 4.0.0 (what `discord.js` installs) | `InspectOptionsStylized` | ≤ 22 |
| 5.0.0 | `InspectContext` | 26 |

`@discordjs/builders@1.14.1`, the current release, declares `^4.0.0` — so no
`discord.js` version reaches shapeshift 5 yet, and there is no combination that
satisfies both type lines.

**Fix — one line in your `tsconfig.json`:**

```jsonc
{ "include": ["src", "node_modules/@theokit/gateway-discord/shims/types-node-26.d.ts"] }
```

That file ships with this package and restores the renamed type. It is **opt-in and
loaded by nothing** — a library that augments Node's own types for everyone changes
the type environment of people who never asked. Measured 2026-08-29 in a scratch
consumer: `@types/node@26` fails to compile without it and passes with it, and
`@types/node@22` passes either way, since the declaration merges with the interface
that already exists there.

Two alternatives, if you would rather not add the file: pin `@types/node` to `^22`,
which is what `engines.node: >=22.12.0` here is typechecked against, or set
`skipLibCheck: true` — most scaffolds do, though TypeScript's own default is `false`,
which is why this is reachable at all.

Tracked in [#81](https://github.com/usetheokit/theokit-gateways/issues/81). It closes
when `@discordjs/builders` moves to shapeshift 5; the shim's own header says how you
will find out without having to watch for it.

## License

Apache-2.0
