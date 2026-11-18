---
"@theokit/gateway": minor
"@theokit/gateway-line": patch
---

`@theokit/gateway` exports `channelConfigReaders(prefix)`, the config readers (`invalid`, `isAbsent`, `readString`, `requiredString`, `readBoolean`, `readFunction`) that channel packages each copied. `@theokit/gateway-line` uses them and raises its `@theokit/gateway` peer floor to `>=0.21.0`.
