---
"@theokit/gateway": minor
"@theokit/gateway-line": patch
---

`@theokit/gateway` exports `channelConfigReaders(prefix)`, the config readers (`invalid`, `isAbsent`, `readString`, `requiredString`, `readBoolean`, `readFunction`) that channel packages each copied. `@theokit/gateway-line` keeps its own copy of the readers until `@theokit/gateway@0.22.0` ships the export, and raises its `@theokit/gateway` peer floor to `>=0.21.0`.
