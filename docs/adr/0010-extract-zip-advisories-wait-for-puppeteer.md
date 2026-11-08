# 0010. The extract-zip advisories wait for puppeteer

## Status

Accepted 2026-11-07. Sunset 2027-02-04 (90 days).

## Context

`pnpm audit --audit-level high` is the dependency gate. After the lockfile was regenerated with
overrides for every patched critical and high advisory (see `docs/security/dependency-advisories.md`),
two highs remain: GHSA-jmr9-qjv8-65gv and GHSA-7pqw-9j4j-h8q3 against `extract-zip <=2.0.1`.
No patched `extract-zip` exists (the advisory lists no fixed version). It is reached only through
`packages/gateway-whatsapp > whatsapp-web.js > puppeteer > @puppeteer/browsers`, a devDependency
tree: `whatsapp-web.js` is an optional peer, and no published package depends on `extract-zip`.

## Decision

The two ids are listed in `pnpm.auditConfig.ignoreGhsas` in the root `package.json` and in
`docs/security/dependency-allowlist.json`, each with a sunset inside 90 days.
`tools/tests/dependency-allowlist.test.mjs` fails when the two lists differ, when a sunset is past, or
when a sunset is more than 90 days after the entry was added. Nothing else may be allowlisted
without its own entry and a reason here.

## Consequences

The exposure is the browser download step of puppeteer in a contributor's install, not a consumer's.
At the sunset, either `@puppeteer/browsers` has moved off `extract-zip` or this decision is renewed
with a new review.
