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
arrives within `connectTimeoutMs` (10 s by default), or when the port is held by another
listener. A `connect()` made while another is pending shares its answer. A `disconnect()` made
while one is pending wins: that connect answers `false` and leaves no listener, and the next
`connect()` starts a fresh session.

The route listens on its own Express app, port 3000 by default. Every webhook adapter in this
family defaults to 3000, so two of them in one process need distinct `port` values or one
Express app passed to each as `app`; with `app` the adapter mounts its route there and you call
`listen`. A request with no bearer token is refused with 401 before its body is read, and a body
over 1 MiB with 413 and `{"error":"request body too large"}`.

### Serving the webhook from your own route

Pass `webhook: "external"` when your app already has an HTTP server (a Fetch handler, Hono, a
serverless function). `connect()` then fetches the first access token and opens nothing; no port is
bound and `express` is not loaded. Your route passes each request to `handleRequest`:

```ts
const adapter = new GoogleChatAdapter({ serviceAccountEmail, privateKey, audience, webhook: "external" });
await adapter.connect();

const MAX_BODY_BYTES = 1024 * 1024;

// in your route:
const authorization = request.headers.get("authorization");
if (authorization === null || !/^Bearer\s+\S/i.test(authorization)) {
  return new Response(null, { status: 401 }); // before the body is read
}
const declared = Number(request.headers.get("content-length") ?? 0);
if (declared > MAX_BODY_BYTES) return Response.json({ error: "request body too large" }, { status: 413 });

// Read the body as a stream and stop at the cap, since content-length may be absent or wrong.
const chunks: Uint8Array[] = [];
let received = 0;
const reader = request.body?.getReader();
while (reader !== undefined) {
  const { done, value } = await reader.read();
  if (done) break;
  received += value.byteLength;
  if (received > MAX_BODY_BYTES) {
    await reader.cancel();
    return Response.json({ error: "request body too large" }, { status: 413 });
  }
  chunks.push(value);
}
const rawBody = Buffer.concat(chunks).toString("utf8");

const { status, body } = await adapter.handleRequest(authorization, rawBody);
return Response.json(body, { status });
```

`handleRequest` verifies the bearer token (Google's signature, issuer, audience and expiry), then
parses the body. The token proves the request came from Google Chat for your `audience`; it does
not sign the body. The 401 and 413 checks above keep an unauthenticated caller from making you
read an unbounded body, but they do not replace the token verification `handleRequest` does.
`webhook: "external"` together with `app` or `port` throws `GatewayConfigurationError` with code
`conflicting_webhook_options`.

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

## Verification status (2026-11-05)

Offline coverage includes authenticated inbound events routed through `GatewayRunner` and
replies sent through the adapter's REST transport, with Google endpoints replaced by deterministic
fixtures. Application handlers only use the gateway event and `ctx.reply()`.

A real-account send-and-receive run has **not been performed** in this sandbox: no Google Chat
account or service-account credentials are available. This package is not claimed as live verified.
To complete that check, configure a Chat app and its service account, expose the quick-start
endpoint over HTTPS, add the app to a space, and send it a unique message. Record the date,
received message resource name, and visible reply resource name (never credentials) after
confirming the reply appears in that space. TheoClaw integration also remains unverified here.

## Channel descriptor

`googleChatChannel` describes the channel as data, for `createChannels` and `configFromEnv` from
`@theokit/gateway`.

| Field | Env | Required | Secret |
| --- | --- | --- | --- |
| `serviceAccountEmail` | `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL` | see below | no |
| `privateKey` | `GOOGLE_CHAT_PRIVATE_KEY` | see below | yes |
| `serviceAccountFile` | `GOOGLE_CHAT_SERVICE_ACCOUNT_FILE` | see below | no |
| `audience` | `GOOGLE_CHAT_AUDIENCE` | yes | no |
| `webhook` | `GOOGLE_CHAT_WEBHOOK` | no | no |

Credentials come from `serviceAccountEmail` and `privateKey`, or from the JSON key at
`serviceAccountFile` (`client_email`, `private_key`) for whichever of the two is absent; `create`
throws `invalid_config` when the file cannot be read. The descriptor is the `inline` shape (email and
key required); `selectVariant(googleChatChannel, "file")` is the shape that requires
`serviceAccountFile` instead, so a missing credential is reported as `missing_required_config`. `webhook` is
`"listener"` (default) or `"external"`.

```ts
import { configFromEnv, createChannels, selectVariant } from "@theokit/gateway";
import { googleChatChannel } from "@theokit/gateway-google-chat";

const descriptor = selectVariant(googleChatChannel, "file"); // or "inline"
const { config } = configFromEnv(descriptor, process.env, "APP_");
const { adapters, rejected } = createChannels([{ descriptor, config }]);
```
