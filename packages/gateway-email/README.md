# `@theokit/gateway-email`

Email platform adapter for `@theokit/gateway`. Built on the community-standard 2026 Node email stack: `nodemailer` (SMTP) + `imapflow` (IMAP IDLE) + `mailparser` (RFC 5322 parsing).

Status: **v0.1.0 pre-release**. Pre-1.0 contract per ADR D338 — breaking changes allowed within 0.x.

## How inbound arrives

**IMAP IDLE.** The adapter polls the mailbox over its own connection; messages reach `onInbound`
once `connect()` resolves. There is no webhook to host and nothing for an application to
authenticate.

## Channel descriptor

`emailChannel` describes the channel as data for `createChannels` and `configFromEnv` from `@theokit/gateway`. Its transport is `socket`.

```ts
import { configFromEnv, createChannels } from "@theokit/gateway";
import { emailChannel } from "@theokit/gateway-email";

const { config, missing, secrets } = configFromEnv(emailChannel, process.env, "APP_");
const { adapters, rejected } = createChannels([{ descriptor: emailChannel, config, envPrefix: "APP_" }]);
```

| Config key | Env name | Required | Secret |
| --- | --- | --- | --- |
| `address` | `EMAIL_ADDRESS` | yes | no |
| `password` | `EMAIL_PASSWORD` | yes | yes |
| `imapHost` | `EMAIL_IMAP_HOST` | yes | no |
| `imapPort` | `EMAIL_IMAP_PORT` | no | no |
| `smtpHost` | `EMAIL_SMTP_HOST` | yes | no |
| `smtpPort` | `EMAIL_SMTP_PORT` | no | no |
| `fromName` | `EMAIL_FROM_NAME` | no | no |
| `allowedSenders` | `EMAIL_ALLOWED_SENDERS` | no | no |
| `allowAutomated` | `EMAIL_ALLOW_AUTOMATED` | no | no |
| `pollIntervalMs` | `EMAIL_POLL_INTERVAL_MS` | no | no |
| `maxBodyChars` | `EMAIL_MAX_BODY_CHARS` | no | no |
| `cursorStore` | none (object) | no | no |

The `APP_` prefix is the app's choice. A value of the wrong type throws `invalid_config` naming the key; a list may be an array or a comma-separated string, a boolean `true`/`false` or the same strings, a number a number or a digit string.