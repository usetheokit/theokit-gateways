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
