---
"@theokit/gateway-signal": minor
---

Add a `senderKey` option (`"uuid"` default, or `"number"`) to choose whether `sender.id` is the sender's UUID or phone number. An invalid value throws `GatewayConfigurationError` (`invalid_config`).
