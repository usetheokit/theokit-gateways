---
"@theokit/gateway": minor
---

Export `ReconnectBackoff` and `ReconnectBackoffOptions` so adapters that hold a long-lived connection can share the runner's reconnect backoff, including a reset after a stable connection. `GatewayRunner` now uses it for its own retries.
