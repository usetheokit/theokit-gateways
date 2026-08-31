# `@theokit/gateway-email`

Email platform adapter for `@theokit/gateway`. Built on the community-standard 2026 Node email stack: `nodemailer` (SMTP) + `imapflow` (IMAP IDLE) + `mailparser` (RFC 5322 parsing).

Status: **v0.1.0 pre-release**. Pre-1.0 contract per ADR D338 — breaking changes allowed within 0.x.

## How inbound arrives

**IMAP IDLE.** The adapter polls the mailbox over its own connection; messages reach `onInbound`
once `connect()` resolves. There is no webhook to host and nothing for an application to
authenticate.
