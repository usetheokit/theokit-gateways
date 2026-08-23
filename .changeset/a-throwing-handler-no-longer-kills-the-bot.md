---
"@theokit/gateway": patch
"@theokit/gateway-teams": patch
"@theokit/gateway-whatsapp": patch
"@theokit/gateway-discord": patch
"@theokit/gateway-telegram": patch
"@theokit/gateway-email": patch
---

**A message whose handler throws no longer kills the bot.** On Teams and on WhatsApp's web backend it did — not degraded delivery, an exit code. `Error: ... / Node.js v22.22.2`, and the next message never arrived.

Both dispatched with `void handler(event)`. `void` reads as "I am not waiting for this"; what it tells the runtime is "I am not handling the error", and under Node 22's default an unhandled rejection ends the process. Measured against both adapters through their own injection seams before the fix, and again after: the throw is now contained, named, and delivery continues.

**Discord and Telegram contained it but blamed the wrong thing.** The rejection escaped into the platform library's error channel, so a bug in the consumer's own handler surfaced as `[discord] client error` / `[telegram] bot error`. Anyone debugging that went looking in discord.js and grammy for a fault that was in their own code. Both now report `handler threw` and return `"handler_threw"` from the internal dispatch seam.

**WhatsApp Cloud dropped the rest of the batch, and made the platform resend it.** Meta packs several messages and their delivery receipts into one webhook, and the dispatch loop awaited each handler with nothing around it. One throw skipped every remaining message in the payload, skipped the status receipts, and rejected `handleWebhookPayload` — so the caller's route answered 500 and Meta redelivered the whole batch, replaying the messages that had already been handled. That is a duplicate-reply bug reached through a different door than the one fixed in #11. The same method also now answers `false` on a signed body that is not JSON, instead of throwing out of a method whose contract is `true`/`false`.

**Email gained a net it did not strictly need.** Its drain is written never to reject, and it does not — but both launch sites discard the promise, so that property was the only thing between a future edit and the same fatal rejection, and nothing enforced it. The catch now lives at the site that would pay for it.

**The contract is written down, and held to.** `BasePlatformAdapter.onInbound` now states it: a handler may throw, and an adapter must contain that throw, report it as the handler's failure rather than the platform's, and keep delivering. Eight of ten adapters had converged on exactly that with nothing recording it. `tests/lint/adapter-contract.test.ts` gains two invariants — every adapter names a handler throw as the handler's, and no adapter launches a user callback with a bare `void` — and both were checked against a deliberately reverted adapter to confirm they fire rather than pass vacuously.
