# @theokit/gateway-google-chat

Google Chat platform adapter for [`@theokit/gateway`](../gateway).

A Chat app receives each interaction as an HTTPS request from Google, and replies through the
Chat REST API. The adapter verifies every request's Google-signed token with keys it reads
itself, and signs its own token requests with the service account's key. It uses `node:crypto`
and `fetch` only, so the package has no runtime dependencies; `express` is an optional peer for
the webhook listener.

## How inbound arrives

**A webhook.** Google posts each event to the app's HTTP endpoint with
`Authorization: Bearer <ID token>`. The adapter accepts the request only when the token:

- is RS256 and verifies under a key from Google's published set
  (`https://www.googleapis.com/oauth2/v3/certs`);
- was issued by `https://accounts.google.com` (or `accounts.google.com`);
- has `aud` equal to `audience`, compared exactly;
- has `email` `chat@system.gserviceaccount.com` with `email_verified` true;
- has not expired (60 s of clock skew allowed).

Anything else answers 401 and reaches no handler. When Google's key set cannot be read at all,
the answer is 503, so an outage is not mistaken for a forged token. The key set is cached for the
`max-age` Google declares, and a token naming an unknown key causes at most one read per minute,
whatever the sender sends.

A `MESSAGE` event becomes a `GoogleChatMessageEvent`; other event types answer 200 and produce
nothing. The request is answered before the handler runs, and with 503 when no handler is
registered.

## Install

```bash
pnpm add @theokit/gateway @theokit/gateway-google-chat express
```

## Quick start

```ts
import { GatewayRunner } from "@theokit/gateway";
import { GoogleChatAdapter } from "@theokit/gateway-google-chat";

const adapter = new GoogleChatAdapter({
  serviceAccountEmail: process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL!,
  privateKey: process.env.GOOGLE_CHAT_PRIVATE_KEY!,
  audience: "https://bot.example.com/google-chat",
  port: 3000,
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`you said: ${event.text}`);
  },
});
await runner.start();
```

`connect()` obtains the first access token and then starts the listener. It returns `false`
(never a throw) when the key is not a PEM private key, the token exchange fails, or no token
arrives within `connectTimeoutMs` (10 s by default).

`audience` must be exactly the HTTP endpoint URL configured for the app in the Google Cloud
console (Chat API → Configuration). A trailing slash on one side and not the other refuses every
request.

## Channels

`channel.id` is the space's resource name (`spaces/<id>`), and `channel.type` is `"dm"` for a
direct message and `"group"` otherwise. A reply goes to that space. The event's `text` is the
message's `argumentText` (the text without the app's mention) when it holds anything, and its
`text` otherwise.

## Formatting

With `format: "markdown"` the adapter removes the markers (`**`, `_`, `~~`, `` ` ``) and sends
plain text; `html` is sent unchanged, with one warning per adapter. How Chat renders its own
markup in a reply is not measured yet, and long texts are not split.

## Send results

| Outcome | `error.code` |
|---|---|
| empty text | `empty_text` |
| channel id is not a space name (`spaces/<id>`) | `invalid_space` |
| `connect()` has not succeeded | `not_connected` |
| the token exchange failed | `google_chat_auth_error` |
| the Chat API refused the message, or the request failed | `google_chat_http_error` |

A successful send returns the created message's resource name as `messageId`. An access token
is reused until a minute before it expires, and concurrent sends share one token exchange.
