---
"@theokit/gateway-line": patch
---

`@theokit/gateway-line` keeps its own config readers instead of importing `channelConfigReaders`, which `@theokit/gateway@0.21.0` does not export, so it loads against any core its peer range admits.
