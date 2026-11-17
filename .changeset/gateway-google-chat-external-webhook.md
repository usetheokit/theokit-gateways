---
"@theokit/gateway-google-chat": minor
---

Add `webhook: "external"`: `connect()` fetches the first access token and opens no listener, so a host can serve the webhook from its own route through `handleRequest`. Combining it with `app` or `port` throws `conflicting_webhook_options`.
