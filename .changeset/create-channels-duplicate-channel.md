---
"@theokit/gateway": patch
---

`createChannels` builds one adapter per platform. In 0.11.0 it built every entry, so two entries
for one platform gave a `GatewayRunner` two adapters of that platform: the runner sent the first
one's replies through the second and never disconnected the first. A later entry for a platform
it already built is now rejected with a `GatewayConfigurationError` coded `duplicate_channel`, and
its `create` is not called. If your app lists two entries for one platform, the second one now
lands in `rejected` instead of being built. The first entry built for a platform wins, and an
entry rejected for its configuration does not claim its platform.

An entry whose `create` returns an adapter reporting another platform than its descriptor declares
is rejected with the code `platform_mismatch`, and the adapter it built is dropped unconnected.
The runner keys adapters by the adapter's own platform, so such an adapter would otherwise reach
it as a second adapter for a platform the duplicate check never saw.
