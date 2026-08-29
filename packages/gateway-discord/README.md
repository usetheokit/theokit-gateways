# @theokit/gateway-discord

Discord platform adapter for `@theokit/gateway`. Wraps [discord.js](https://discord.js.org/) in the `BasePlatformAdapter` contract.

> **Status: 0.1.0 — pre-release.**

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

**Workaround:** pin `@types/node` to `^22`, which is what `engines.node: >=22.12.0`
here is typechecked against, or keep `skipLibCheck: true` (the default). Tracked in
[#81](https://github.com/usetheokit/theokit-gateways/issues/81); it closes when
`@discordjs/builders` moves to shapeshift 5.

## License

Apache-2.0
