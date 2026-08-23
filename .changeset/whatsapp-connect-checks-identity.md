---
"@theokit/gateway-whatsapp": patch
---

**`connect()` now checks that the credential resolves to the configured phone number, not merely that the request succeeded.** The first version read only the HTTP status, which meant three ways to report a working credential that does not work:

- a `200` carrying an error envelope, which Meta does send;
- an empty or unreadable `200`, which a captive portal or proxy sends;
- a `200` describing a **different node** — and this is the live one. Pasting a WhatsApp Business Account id where the phone number id belongs is the commonest Cloud API misconfiguration, and `GET /{waba_id}` with a management-scoped token answers `200`. The check said yes; every send then failed.

That last case is exactly what the method's own docblock claimed to catch — *"a token can be valid and still have no access to this phone number id"* — while the code checked access and not identity. The response names the node it reached, so the fix is to compare it, and the refusal now says which node it got and which it expected.

Also fixed: a `disconnect()` arriving while a verification was in flight left `connected` set to `true` when that verification resolved, so every later `connect()` short-circuited on a flag no live check stood behind — despite the field's own comment promising `disconnect()` cleared it. A generation counter retires the abandoned attempt, the same guard the Baileys backend carries.
