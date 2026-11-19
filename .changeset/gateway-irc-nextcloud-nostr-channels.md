---
"@theokit/gateway-irc": minor
"@theokit/gateway-nextcloud-talk": minor
"@theokit/gateway-nostr": minor
---

Export a `ChannelDescriptor` with environment variable bindings: `ircChannel`, `nextcloudTalkChannel` and `nostrChannel`, for use with `createChannels` and `configFromEnv`. The `@theokit/gateway` peer floor is `>=0.23.0`, the release that adds the `readNumber`, `readList` and `readBooleanString` readers the descriptors call.
