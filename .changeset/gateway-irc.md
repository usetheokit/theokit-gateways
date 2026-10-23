---
"@theokit/gateway-irc": minor
---

Add `@theokit/gateway-irc`, an IRC adapter.

`@theokit/gateway-irc` (first release) exports `IrcAdapter`, which speaks the IRC line protocol
itself over `node:tls` (port 6697 by default) or `node:net`. `connect()` sends `PASS` when a
server password is set, negotiates SASL PLAIN when `saslPassword` is set (ending with `CAP END`
after numeric 903), retries a nick in use with `_` up to 3 times, joins every channel and returns
`true` once each join is confirmed. It returns `false`, never a throw, on `ERROR`, 464, 465, a
SASL failure, a refused join, a closed socket or when `connectTimeoutMs` passes first. A
`connect()` made while another is registering shares its answer; after a `disconnect()` the
pending one answers `false` and the next `connect()` opens a fresh connection. `PING` is
answered with `PONG`. A `PRIVMSG` from another nick becomes an `IrcMessageEvent`; `/me` arrives as
its text with `irc.action` true, other CTCP requests and the adapter's own messages are dropped.
`sendMessage` sends one `PRIVMSG` per line and cuts a long line so each command fits 512 bytes
with 100 bytes left for the relay prefix, never inside a UTF-8 character; `splitForIrc` is
exported. A send answers once the socket has taken the write, and returns `irc_write_error` when
the socket refuses it (EPIPE on a half-closed connection). A send returns no `messageId`, since
baseline IRC has none. The package has no runtime
dependencies and requires `@theokit/gateway` 0.12.0 or later, the first version with the `irc`
key.
