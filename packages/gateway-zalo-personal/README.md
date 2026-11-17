# @theokit/gateway-zalo-personal

Zalo Personal platform adapter for [`@theokit/gateway`](../gateway): it drives a **personal** Zalo
account (not an Official Account) through the unofficial [`zca-js`](https://github.com/RFS-ADRENO/zca-js)
web session.

**Unofficial.** Zalo offers no API for personal accounts. Automating one may get it restricted; use
a throwaway account.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-zalo-personal zca-js
```

`zca-js` is not a dependency of this package: it is imported when `connect()` runs, and `connect()`
answers `false` naming it when it is missing.

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { ZaloPersonalAdapter } from "@theokit/gateway-zalo-personal";

const adapter = new ZaloPersonalAdapter({
  credentials: { cookie: JSON.parse(process.env.ZALO_COOKIE ?? "[]"), imei: "...", userAgent: "..." },
});
const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (_event, ctx) => ctx.reply("hello"),
});
await runner.start();
```

## Behaviour

- Inbound: direct (`channel.type` `dm`) and group text messages from others; the account's own
  messages, repeats and non-text messages are dropped.
- Outbound: text only, in a direct chat or group by `channel.type`; markdown loses its markers; a
  reply over 2000 characters goes as several messages. Attachments are refused with
  `attachments_unsupported`.
- The web session is not refreshed; supply a new one when Zalo ends it.

## Status

Unverified: the wire calls are written against the `zca-js` API as documented and tested with a
scripted fake. No send-and-receive run against a real account has been recorded.

## Capabilities

`adapter.capabilities` reports `maxMessageChars` is the splitter's limit (exported from this package) and `threads` is `false`; other fields follow the defaults of `@theokit/gateway`.

## Channel descriptor

`zaloPersonalChannel` is a `ChannelDescriptor` (transport `socket`) for `createChannels`; bind it to the environment with `configFromEnv` (needs `@theokit/gateway >=0.20.0`).

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { zaloPersonalChannel } from "@theokit/gateway-zalo-personal";

const { config, missing } = configFromEnv(zaloPersonalChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([{ descriptor: zaloPersonalChannel, config }]);
```

| Env name | Option | Required | Secret |
| --- | --- | --- | --- |
| `ZALO_PERSONAL_CREDENTIALS` | `credentials` (JSON text of `{ cookie, imei, userAgent }`) | yes | yes |

Options without an env name are programmatic only. `create` makes no network call and throws a `GatewayConfigurationError` (`invalid_config`, naming the key) for a wrongly typed value.
