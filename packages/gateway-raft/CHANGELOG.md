# @theokit/gateway-raft

## 0.2.0

### Minor Changes

- d6fe699: Export `signalChannel`, `imessageChannel` and `raftChannel`: channel descriptors with an environment variable bound to each option, for `createChannels` and `configFromEnv`.

  The three packages now require `@theokit/gateway >=0.22.0` and read channel config with its shared `channelConfigReaders`.

## 0.1.1

### Patch Changes

- bca7cfd: Raise the `@theokit/gateway` peer floor to the core version that ships the APIs this adapter imports, so npm no longer installs it next to a core it cannot load.

## 0.1.0

### Minor Changes

- db894a4: Add `@theokit/gateway-raft`, a Raft External Agent adapter over the Raft CLI wake bridge.

  `RaftAdapter` runs `raft wake --json`, turns each wake line into a message and replies through
  `raft reply`. Requires `@theokit/gateway` 0.12.0 or later. The CLI wire contract is an assumption
  and the adapter is not yet run against a live Raft account.
