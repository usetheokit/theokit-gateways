---
"@theokit/gateway-telegram": patch
---

A chunk (or photo caption) that Telegram refuses with a legacy Markdown parse error is now resent once as plain text, so the reply arrives and later chunks are no longer dropped.
