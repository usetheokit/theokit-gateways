---
"@theokit/gateway": patch
---

`createChannels` builds one adapter per platform. A later entry for a platform it already built
is rejected with a `GatewayConfigurationError` coded `duplicate_channel`, and its `create` is not
called. The first entry built for a platform wins, and an entry rejected for its configuration
does not claim its platform. A `GatewayRunner` given two adapters of one platform sends the
first one's replies through the second and never disconnects the first.
