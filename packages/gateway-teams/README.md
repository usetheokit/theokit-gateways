# `@theokit/gateway-teams`

Microsoft Teams platform adapter for `@theokit/gateway`. Built on the modern `@microsoft/teams.apps` v2 SDK.

Status: **v0.1.0 pre-release**. Pre-1.0 contract per ADR D324 — breaking changes allowed within 0.x.

## How inbound arrives

**The Microsoft SDK's own HTTP server.** `@microsoft/teams.apps` listens on the port passed to
`connect()` and validates the Bot Framework JWT itself; activities reach `onInbound` from there.

There is no signature for an application to check. A validator here would mean reimplementing
Microsoft's JWT and JWKS handling, which the SDK already owns.
