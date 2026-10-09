# ADR-0005: The Teams verifier owns key retrieval and checks signatures before the SDK

- Status: Accepted
- Date: 2026-10-06
- Deciders: gateway cluster maintainers, on the technical arbiter's verdict for B-420
- Supersedes: the consequence "Unknown signing keys are budgeted, and a published key is never
  starved" of [ADR-0003](0003-teams-verifier-uses-the-sdk-validator-by-dist-path.md)
- Evidence: the `gateway-teams-inbound-verifier` plan, its review findings, and the installed
  `@microsoft/teams.apps` 2.0.15 read on 2026-10-06

## Context and Problem Statement

ADR-0003 hands every inbound token to the SDK validator. That validator builds a `jwks-rsa` client
with nothing configured, so it runs on the library defaults: no rate limit, an LRU cache of 5 keys
kept for 10 minutes, filled only with keys it found. `jsonwebtoken` asks that client for the key
before it checks the signature, the algorithm or the expiry, and the sender chooses the `kid`.

ADR-0003 answered this with a budget: 10 unknown kids a minute, kids learned from accepted tokens,
and a read of the published Bot Framework set once the budget was spent. Every part of that was a
guess, made from outside, about the state of a cache the verifier can neither configure nor
observe. The review found four places where the guess and the cache disagree:

| Finding | The guess | What the cache does |
|---|---|---|
| #61 | a learned kid stays cached | the LRU forgets it after 10 minutes, and never stores a retired key |
| #64 | a listed kid is cheap | the cache holds 5 keys; Microsoft publishes many more, so cycling listed kids misses every time |
| #62 | one budget fits both issuers | the SDK uses separate key clients, and forged Bot Framework tokens spent the tenant's slots |
| F-dom-t-4 | per-kid is the right key | SDK 2.1.x builds one key client per unverified `tid` |

A second defect sat beside them (F-arch-16): a key set that could not be read was reported as
`invalid_token`, the same answer as a forged token, so a route could not tell "retry" from
"refuse".

## Decision

**The verifier reads the published key sets itself and verifies the RS256 signature locally,
before it calls the SDK `check()`. The SDK remains the authority on issuer, audience, expiry and
`serviceurl`.**

- One key set per URL: the Bot Framework set (the cloud's `openIdMetadataUrl` with
  `/openidconfiguration` replaced by `/keys`, the rule both 2.0.15 and 2.1.0 apply), and, only when
  `tenantId` is configured, `{loginEndpoint}/{tenantId}/discovery/v2.0/keys`, the URL 2.1.x derives.
  Without a `tenantId` a tenant-issued token is already refused before any key work.
- Each set has at most one read in flight, shared by concurrent callers, and no read starts within
  10 seconds of the previous one, whatever triggered it. A read is triggered by having no copy, by
  a `kid` missing from the copy, or by a copy older than one hour.
- A successful read replaces the whole set; nothing is learned, so a retired key is gone after the
  next read. A failed read keeps the last good copy. The response is capped at 1 MiB and 1000 keys.
  Keys are kept as `node:crypto` `KeyObject`s, and only RSA keys are kept. A read is successful only
  when the document lists at least one usable RSA key (amended 2026-10-07, below).
- Per request, after the checks that cost nothing (missing header, oversized or malformed body, no
  `kid`, a tenant the verifier would refuse anyway): the set is chosen by the unverified `iss`, the
  header must name `RS256`, the `kid` must be listed, and the signature must verify. An unlisted
  `kid` after a successful read is `invalid_token`; no readable copy listing it is the new reason
  `key_set_unavailable`, which a route answers with a 503. A failed signature is `invalid_token`
  and the SDK is never asked.
- The unknown-key budget, the learn path and the separate published-set reader are deleted. No new
  dependency.

## Considered Options

1. **The verifier owns key retrieval and checks the signature first** (chosen). It closes the four
   findings by construction: a forged token, whatever `kid` or `tid` it names, costs at most one
   read per set per 10 seconds and never reaches a key client that would fetch.
2. **Keep the SDK path and admit only kids the verifier's copy lists.** Rejected: it does not close
   #64. The SDK caches 5 keys, so a sender cycling 6 or more listed kids in `alg: none` tokens
   passes the gate and misses the SDK cache on every request. Budgeting listed kids again brings
   back #62, because genuine tokens carry listed kids too.
3. **Replace the SDK validator with a full local one** (issuer, audience, expiry, `serviceurl`).
   Rejected: it restates Microsoft's claim rules, the drift ADR-0003 rejected, and buys nothing
   option 1 does not.
4. **Swap the SDK's private `jwksCache` for a client the verifier controls.** Rejected: it couples
   to a private field, deeper than the `dist` path ADR-0003 already accepts, and an SDK refactor
   would break it without a type error.

## Consequences

- **Outbound ceiling.** At most 12 key-set reads a minute from the verifier (6 per set, and the
  tenant set only with `tenantId`), plus the SDK's own fetch for tokens Microsoft actually signed:
  one per genuine `kid` per 10 minutes. A sender cannot cause an SDK fetch. Before this change the
  ceiling grew with the request rate (#64).
- **Accepted cold-start cost.** On first use the key set is read twice, once by the verifier and
  once by the SDK. ADR-0003 cited this cost when it rejected reading the set in the verifier; it is
  now the price of deciding when reads happen.
- **A key published less than 10 seconds after a read** is refused as `invalid_token` until the
  next read. Microsoft publishes keys ahead of use, so this edge is expected to be rare.
- **A cold start during a key-set outage** answers `key_set_unavailable` until a read succeeds, at
  most one attempt every 10 seconds. With a copy held, local verification keeps working, and the
  SDK refuses only if its own cache misses and its own fetch fails, which is unchanged.
- **CPU.** One RSA-2048 verify per well-formed token naming a listed key, done before the SDK
  repeats the same work.
- **Public type.** `TeamsActivityVerifyResult` gains `key_set_unavailable`. Code that switches
  exhaustively over `reason` needs the new case.
- The URL rules are pinned by tests that run the installed 2.0.15 validator against a local key
  server, and by a test that pins the tenant URL 2.1.x derives.

## What was not established

- **The count of published Bot Framework keys** (239 in the review's live reading) was not
  re-measured here. The design does not depend on it: any count above 5 reproduces #64.
- **SDK 2.1.x behaviour** was read in the 2.1.0 tarball, not executed. Only 2.0.15 is installed,
  and the tenant URL test pins the URL rule, not 2.1.x itself.
- **The one-hour maximum age** of a held copy is a proposal, not a measurement. The SDK, which
  still checks every accepted token with its own 10-minute cache, bounds how long a revoked key
  can be accepted whatever this value is.

## Amended 2026-10-07: stale-while-revalidate, and the SDK's own key read

Two review findings changed how the decision above runs, without changing what it decides.

- **A copy an hour old no longer holds a request.** The performance review (PF-D7.1) found that
  `lookup()` awaited the hourly read even for a `kid` the copy lists, and that, with the read
  interval equal to the 10-second read timeout, a hanging endpoint drove reads back to back, so
  almost every request waited up to 10 seconds for as long as the endpoint hung. Now a `kid` the
  held copy lists is answered from it at once, and an hour-old copy starts a read in the
  background that nothing awaits; only a missing copy or a missing `kid` waits for a read. The
  10-second gap is counted from the end of the previous read, so no read starts within 10 seconds
  of another's start or end. The rest stands: one read in flight per set, shared; the 1 MiB and
  1000-key caps; replace on success; the last good copy kept on failure. The cost: after the hour,
  a retired key verifies until the background read completes, which is as long as one read takes,
  or for as long as reads fail, as before.
- **The SDK's own key read is no longer read as a forgery** (code review #68). The SDK still reads
  the key for a token whose signature the verifier verified, and when that read fails it refuses
  with the plain `Error` it uses for a forgery, so a genuine activity during a key-endpoint outage
  longer than its 10-minute cache was answered `invalid_token`. The verifier now hands the SDK a
  logger that, inside the `check()` call that logged it (`AsyncLocalStorage`), notes the SDK's
  "Failed to get signing key" line, and answers such a refusal `key_set_unavailable`. A
  `SigningKeyNotFoundError` is left out: there the SDK's read succeeded and does not list the key.
  This reads a log line, not an API: it is the same text in 2.0.15 (run), and 2.0.16 and 2.1.0
  (read in the tarballs). If an SDK changes it, the answer falls back to `invalid_token`, the
  behaviour before this amendment, never to an acceptance; a test on the installed SDK pins it.
  Option 4 above stays rejected: nothing replaces the SDK's key client.

## Amended 2026-10-07: a metadata URL the key-set URL cannot be derived from

The Bot Framework key-set URL is the cloud's `openIdMetadataUrl` with its trailing
`/openidconfiguration` replaced by `/keys`. A URL ending any other way (the OIDC-standard
`/.well-known/openid-configuration`, a trailing slash, a query string) was passed through unchanged
and fetched as the key set; the document has no `keys` array, so every request was refused as
`key_set_unavailable`, which says a retry may succeed (code review #95). The verifier now throws a
`TypeError` naming `cloud.openIdMetadataUrl` and the suffix when it is built, the same way it
refuses an empty one. The SDK's public, US government and China values all end in the suffix.

The same review found that a failed read kept no cause (code review #96): every failure became
`undefined` and the refusal message was fixed, so a blocked egress, a 404 and a 503 looked alike
and nothing was logged. A read now returns its failure: the HTTP status, a timeout, the network
error's class and code, or a document too large, not JSON, with no `keys` array or too many keys.
The key set keeps its latest failure, and `key_set_unavailable` names the set, its URL and that
failure. Nothing in it comes from the request, and the verifier still writes no log of its own.

## Amended 2026-10-07: a document with no usable RSA key is a failed read

A document whose `keys` array was empty, or whose every entry was skipped (key material that
`createPublicKey` refuses, or a key that is not RSA), produced an empty set and counted as a
successful read: it replaced the last good copy, every genuine token's `kid` was then unlisted and
refused as `invalid_token`, and no read could start for 10 seconds (code review #39). Such a
document says nothing about which tokens are genuine; it is an empty, truncated or proxied answer
from the key endpoint. It is now a failed read with the cause "the document lists no usable RSA
key": the last good copy is kept, and with no copy the refusal is `key_set_unavailable`. Entries
with no usable RSA key are still skipped when at least one usable RSA key is listed.

## Amended 2026-10-09: what this decision supersedes outside this repository's ADRs

The decision above has the package read key sets and verify RS256 signatures itself. Three records
written before it said the package would not, and the review of 2026-10-08 found none of them
amended (findings F-arch-1 and F-xval-3). This ADR supersedes, for B-420:

- the clause of the alignment brief's NFR-004 "No signature or key handling is written in the
  package", and FR-009's "the verifier does no signature work of its own";
- the plan's "writes no signature code" and its D1 rationale that the SDK does all signature, key
  and expiry work;
- AC-006's grep for `jsonwebtoken` and `jwks` as the whole proof of NFR-004.

What still holds, and what the amended brief and plan now state: no new runtime dependency, no
`dependencies` field, the same two peers, and no import of `jose`, `jwks-rsa` or `jsonwebtoken`.
The only cryptography is `node:crypto`: `createPublicKey` in `published-key-set.ts` and `verify` in
`rs256-signature.ts`. The SDK remains the authority on issuer, audience, expiry and `serviceurl`.

## Amended 2026-10-09: keys are read over https only, and never through a redirect

Construction checked only that each cloud endpoint was a non-empty string, and the key-set read
used the global `fetch`, which follows redirects (finding F-dom-infra-2). A cloud configured with
`http:` had the signature pre-check read its keys in plaintext, where anyone on the network path
could substitute the key set, and a key endpoint could bounce the read to a host nobody configured.

**Decision** (commit 1221c2d).

- Construction refuses, with a `TypeError` naming the field, a `cloud.loginEndpoint`,
  `cloud.tokenIssuer` or `cloud.openIdMetadataUrl` that does not parse as an `https:` URL.
- `http:` stays accepted on three loopback hosts: `localhost`, `127.0.0.1` and `[::1]`. Traffic to
  them never leaves the machine, so there is no network path for an attacker to stand on, and it is
  how the package's tests reach their local key server, which serves plain `http:`. Any other host
  over `http:`, and any other scheme (`ftp:`, none), is refused.
- Every key-set read passes `redirect: "error"`. A 3xx answer is a failed read, kept as such: the
  last good copy stays, and with no copy the refusal is `key_set_unavailable`. The set a redirect
  points at is never fetched.
- A `cloud.loginEndpoint` ending in a slash is refused at construction, and an unverified `iss` is
  taken for an Entra issuer only when it starts with `{loginEndpoint}/` (commit 8275e2d, finding
  F-dom-2 of the auth review). Without the separator,
  `https://login.microsoftonline.com.attacker.example/...` was classified as tenant-issued. It was
  not exploitable, since the classification only chooses the key set and the SDK still checks the
  issuer, but it changed the refusal reason, and the SDK's own 2.0.15 tenant check includes the
  slash.

**Alternatives** (weighed when this amendment was recorded, after the code). Rewriting `http:` to
`https:` silently: rejected, the verifier would fetch a URL the operator did not write, and the typo
would stay hidden. Accepting `http:` behind an opt-in flag for tests: rejected, a flag in a public
options type is a way to switch the check off in production, and the loopback rule already serves
the tests. Following redirects that stay on the configured host: rejected, it adds code for a case
no configured endpoint needed; a key endpoint that redirects is a configuration to fix.

**Consequences.** A sovereign or private cloud configured over `http:` on a real host now fails at
startup instead of at the first request. The SDK's public, US government and China values are all
`https:`. Pinned by `a-cloud-endpoint-not-on-https-is-refused-at-construction.test.ts` and
`a-key-set-read-that-redirects-is-a-failed-read.test.ts`.

## Amended 2026-10-09: read intervals run on the monotonic clock

The 10-second read interval and the one-hour maximum age were computed from `Date.now()`, a wall
clock (finding F-dom-infra-1). A host clock stepped backwards (an NTP correction, a resumed VM, a
restored container snapshot) left the next allowed read in the future by the size of the step, and
for that long a key Microsoft had just published was refused as `invalid_token`, which the README
answers with a 401 the Bot Framework does not retry.

**Decision** (commit 67cc46f). Both are measured with `performance.now()`, which only moves
forward. The key-set cache no longer reads `Date` at all.

**Alternatives** (weighed when this amendment was recorded, after the code). Keeping `Date.now()`
and resetting the interval when the clock is seen to go backwards: rejected, it catches only the
steps it happens to observe and adds a branch to get wrong. `process.hrtime.bigint()`: equivalent
as a clock; not chosen because it returns nanoseconds as a `bigint`, while `performance.now()`
returns milliseconds as a number, the unit of the interval and age constants it is compared with.

**Consequences.** A step of the wall clock in either direction changes nothing about when a read
may happen. Pinned by `a-wall-clock-stepped-back-does-not-stop-key-set-reads.test.ts`; the timing
tests now fake `performance` as well as `Date`, with their assertions unchanged.

## Amended 2026-10-09: where this decision lives in the code

Commit 43ec118 split the verifier by job (finding F-arch-2), with no behaviour change. This
decision is implemented by `published-key-set.ts` (the key-set URLs, the read, its caps and the
cache that decides when a read may happen) and `rs256-signature.ts` (the `node:crypto` verify),
which share `bounded-stream.ts` (a size-limited read) and `error-kind.ts` (the class and code of a
failure, never its text) with the request path. `sdk-validator.ts` holds the logger that notes the
SDK's own failed key read, from the 2026-10-07 amendment. Every one of these files is in the
package's Stryker `mutate` list, so the split moved no code out of the mutation ratchet.

## Verification

`packages/gateway-teams/tests/` holds the evidence. Seven tests were written first and failed on
the previous code: a forged token naming a published key reaches no key client; a retired key
causes no key-set request; a failed signature never reaches the SDK; a tenant-issued token is
accepted after forged Bot Framework tokens; a cold start with no readable key set says
`key_set_unavailable`; the tenant set is read from the URL 2.1.x derives; and 1000 mixed forged
requests read each set at most once per interval.
