# @theokit/gateway-irc

IRC platform adapter for [`@theokit/gateway`](../gateway).

It speaks the IRC line protocol itself (RFC 1459, with IRCv3 message tags) over `node:tls`, or
`node:net` with `tls: false`. The package has no runtime dependencies.

## How inbound arrives

**One long-lived connection.** The adapter registers its nick, joins the channels you list, and
every `PRIVMSG` another nick sends to one of those channels, or to the adapter's nick, becomes an
`IrcMessageEvent`. There is no webhook to host.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-irc
```

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { IrcAdapter } from "@theokit/gateway-irc";

const adapter = new IrcAdapter({
  host: "irc.libera.chat",
  nick: "theobot",
  channels: ["#my-channel"],
  // Optional: log in to a registered NickServ account through SASL PLAIN.
  saslPassword: process.env.IRC_SASL_PASSWORD,
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`);
  },
});
await runner.start();
```

`connect()` returns `true` once the server welcomed the nick (numeric 001) and confirmed every
join (366). It returns `false`, never a throw, on `ERROR`, a refused password (464, 465), a SASL
failure (904), a server that welcomes the nick before SASL succeeded, a refused join, a closed
socket, a `disconnect()` called before registration finished, or when `connectTimeoutMs` (10 s by
default) passes first. A nick in use (433) is retried with `_` appended, up to 3 times. With
`saslPassword`, the adapter negotiates `CAP LS 302`, `CAP REQ :sasl` and `AUTHENTICATE PLAIN`,
and ends with `CAP END` once the server answers 903.

The constructor throws when `nick` or a channel name is malformed, when `password`,
`saslAccount`, `saslPassword`, `realname` or `username` holds a line break or NUL, or when
`username` holds a space.

The adapter answers every `PING` with `PONG`.

## Channels

- A message to a channel has `channel.id` set to the channel (`#name` or `&name`) and
  `channel.type` `"group"`.
- A message to the adapter's nick has `channel.id` set to the sender's nick and `channel.type`
  `"dm"`; a reply to that id goes back to the sender.
- `/me` (CTCP `ACTION`) arrives as its text with `irc.action` set to `true`. Every other CTCP
  request (`VERSION`, `PING`, `TIME`…) is dropped, and so is any message from the adapter's own
  nick.
- The event id is the IRCv3 `msgid` tag when the server sends one, else
  `<nick>:<receivedAt>:<counter>`.

## Formatting

IRC has no markdown. With `format: "markdown"` the markers are removed; `format: "html"` is sent
unchanged and logs one warning per adapter.

## Send results

`sendMessage` sends one `PRIVMSG` per line of text. NUL bytes are removed, and a line too long for
one command is cut so that each command fits 512 bytes with 100 bytes left for the prefix the
server adds when it relays the line. A cut never falls inside a UTF-8 character; `splitForIrc` is
exported for callers that need the same cut.

| Result | When |
| --- | --- |
| `{ ok: true }` | the lines were written to the socket. Baseline IRC has no message id or receipt, so there is no `messageId`. |
| `empty_text` | the text is empty, or holds only line breaks |
| `invalid_target` | `channel.id` holds a space, a comma or a line break, starts with `:`, or is too long to leave room for any text in a 512-byte command |
| `not_connected` | `connect()` has not succeeded, or the connection closed |
