---
"@theokit/gateway": minor
"@theokit/gateway-irc": minor
---

Add `@theokit/gateway-irc`, an IRC adapter, and make `irc` a first-party platform.

`@theokit/gateway` gains the `irc` key in `PlatformEventRegistry`, the `IrcMessageEvent` type,
and a `channelRendering("irc")` row (`plain`, markers removed). `PlatformName` grows by one
member. Code that lists every platform in a `Record<PlatformName, …>` or in a switch with a
`never` default must add an `irc` entry, and a package that registered its own `irc` key through
module augmentation now collides with the first-party one (TS2717) and should drop it.

`@theokit/gateway-irc` (first release) exports `IrcAdapter`, which speaks the IRC line protocol
itself over `node:tls` (port 6697 by default) or `node:net`. `connect()` sends `PASS` when a
server password is set, negotiates SASL PLAIN when `saslPassword` is set (ending with `CAP END`
after numeric 903), retries a nick in use with `_` up to 3 times, joins every channel and returns
`true` once each join is confirmed. It returns `false`, never a throw, on `ERROR`, 464, 465, a
SASL failure, a refused join, a closed socket or when `connectTimeoutMs` passes first. `PING` is
answered with `PONG`. A `PRIVMSG` from another nick becomes an `IrcMessageEvent`; `/me` arrives as
its text with `irc.action` true, other CTCP requests and the adapter's own messages are dropped.
`sendMessage` sends one `PRIVMSG` per line and cuts a long line so each command fits 512 bytes
with 100 bytes left for the relay prefix, never inside a UTF-8 character; `splitForIrc` is
exported. A send returns no `messageId`, since baseline IRC has none. The package has no runtime
dependencies and requires `@theokit/gateway` 0.12.0 or later, the first version with the `irc`
key.
