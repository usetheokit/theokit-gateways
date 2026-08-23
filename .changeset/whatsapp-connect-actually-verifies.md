---
"@theokit/gateway-whatsapp": patch
---

**`WhatsAppCloudBackend.connect()` now asks Meta before reporting success.** It was `return true`, unconditionally — no request, no validation, no error path. A consumer with a wrong, expired or revoked token got success at startup and found out from messages that silently never arrived: no error, no log, nothing to alert on, which is the worst way for a message gateway to fail.

It verifies against the phone number itself rather than `/me`, and that choice is the point: a token can be perfectly valid and still have no access to *this* phone number id, which is the likelier of the two misconfigurations. Checking only the token would wave it through.

The reason survives. `connect()` still returns a boolean — every sibling adapter is tested against "returns false rather than **throwing**", because a throw at startup takes the whole runner down — but it writes the mapped cause to stderr first. Told only `false`, a supervisor cannot tell a revoked token, which needs a human, from a rate limit, which needs a wait.

Verification happens once and is cached, like every sibling: re-asking on each call would turn a health check into a rate-limit source against Meta.

**How it was found is worth more than the fix.** 209 unit tests in this package passed throughout, and none of them could have caught it — the fake backend always accepts, so `return true` is indistinguishable from a successful check. It surfaced on the *first ever* execution of `integration/tests/whatsapp/live.test.ts`, a file whose own header read `NEVER EXECUTED`, minutes after real Cloud API credentials existed for the first time. Measured across the ten adapters: the seven with live coverage all authenticate inside `connect()` and all pass the equivalent assertion. WhatsApp Cloud was the only one that did not.

A cross-adapter gate now fails when any `connect()` body invokes nothing at all. It is deliberately weak — it cannot tell a real check from a pointless one, only that the function does work before claiming the work succeeded — and that is precisely the shape that was missing.

`WhatsAppError` is now a named export, extracted from the inline type inside `WhatsAppSendResult` rather than duplicated beside it: a credential check and a send fail for the same reasons, and two declarations of one vocabulary drift the moment somebody adds a code to one of them. `WhatsAppCredentialCheck` is new. Neither changes an existing shape.
