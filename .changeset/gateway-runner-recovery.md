---
"@theokit/gateway": minor
---

`reconnect: { retryFalse: true }` retries an adapter whose `connect()` answers `false`. A connect the runner abandoned (`connectTimeoutMs`) that rejects later is reported once through `onAdapterState` as `failed`. `runner.connected` is now a method, `runner.connected()`, returning the started adapters (it was a getter returning a set of platform names).
