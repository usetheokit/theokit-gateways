---
"@theokit/gateway-slack": minor
"@theokit/gateway-discord": minor
"@theokit/gateway-telegram": minor
---

Send errors use the shared `SendErrorCode` strings. Discord and Telegram `rate_limited` is now `rate_limit`, and Slack, Discord and Telegram `no_permission` is now `permission_denied`. A rate limit carries `retryAfterMs` when the platform reports it (Slack `retry_after`, Telegram `parameters.retry_after`, discord.js `RateLimitError`), and a permission error keeps the platform's own code in `platformCode`. The `@theokit/gateway` peer range is now `>=0.25.0`.
