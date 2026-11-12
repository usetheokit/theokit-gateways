---
"@theokit/gateway": minor
---

`rawBodyCapture` now refuses a body over 1 MiB with 413 when `maxBytes` is not given. The default is exported as `DEFAULT_WEBHOOK_MAX_BYTES`; pass `maxBytes: Number.POSITIVE_INFINITY` for no limit.
