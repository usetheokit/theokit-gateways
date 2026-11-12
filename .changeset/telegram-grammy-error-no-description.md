---
"@theokit/gateway-telegram": patch
---

`sendMessage` and `editMessage` no longer throw a `TypeError` when Telegram (or a proxy) answers with an error body that has no `description`. The failure now comes back as a `SendResult` with code `telegram_<error_code>`.
