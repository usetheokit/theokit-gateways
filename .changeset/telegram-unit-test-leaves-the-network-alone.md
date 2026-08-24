---
"@theokit/gateway-telegram": patch
---

A unit test no longer calls the real Telegram API.

`EC-I: connect() with bad token resolves to false` produced its failure by sending a bogus token to
`api.telegram.org` and waiting for the 401. That made the suite depend on the network: it failed
when the network was slow and passed when a proxy answered.

The contract worth covering is `init() rejects → connect() returns false, never throws`, and a bogus
token was only a way to produce the rejection. Producing it directly is the same assertion in
milliseconds, and covers the failures a bad token never reaches — a DNS failure, a 5xx, a socket
reset.
