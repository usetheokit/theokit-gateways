---
"@theokit/gateway-line": patch
---

`@theokit/gateway-line` keeps its own copy of the channel config readers until `@theokit/gateway@0.22.0` ships `channelConfigReaders`, so it works with every `@theokit/gateway` its `>=0.21.0` peer floor admits (#564).
