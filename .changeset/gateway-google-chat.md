---
"@theokit/gateway": minor
"@theokit/gateway-google-chat": minor
---

Add `@theokit/gateway-google-chat`, a Google Chat adapter, and make `google_chat` a first-party platform.

`@theokit/gateway` gains the `google_chat` key in `PlatformEventRegistry`, the
`GoogleChatMessageEvent` type, and a `channelRendering("google_chat")` row. `PlatformName` grows by
one member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add a `google_chat` entry, and a package that registered its own `google_chat`
key through module augmentation now collides with the first-party one (TS2717) and should drop it.

`@theokit/gateway-google-chat` (first release) exports `GoogleChatAdapter`, for a Chat app
configured with an HTTP endpoint. Chat's requests arrive on an Express route (default port 3000,
path `/google-chat`; `express` is an optional peer). Every request's bearer token is checked
before its body is read: an RS256 signature under a key from Google's published set, issuer
`accounts.google.com`, an audience equal to the configured `audience`, the Chat service account's
verified email, and an unexpired `exp` with 60 s of skew. A request that fails any check gets 401
and reaches no handler. When Google's key set cannot be read the answer is 503, and no read starts
within 60 s of the previous one. `connect()` exchanges a service-account assertion for an access
token and only then starts the listener. It returns `false`, never a throw, when the key is
unreadable, the exchange fails or no token arrives within `connectTimeoutMs`. Replies go through
`spaces.messages.create`; `channel.id` is the space name, `spaces/<id>`, and anything else is
refused with `invalid_space`. Long messages are not split. The package has no runtime
dependencies and requires `@theokit/gateway` 0.12.0 or later, the first version with the
`google_chat` key.
