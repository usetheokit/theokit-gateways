---
"@theokit/gateway-signal": minor
"@theokit/gateway-imessage": minor
"@theokit/gateway-raft": minor
---

Export `signalChannel`, `imessageChannel` and `raftChannel`: channel descriptors with an environment variable bound to each option, for `createChannels` and `configFromEnv`.

The three packages now require `@theokit/gateway >=0.22.0` and read channel config with its shared `channelConfigReaders`.
