# Dependency advisories

What `pnpm audit` reports here, what of it reaches someone who installs a published package, and
what was done about each.

Measured 2026-08-24 for B-013.

## The headline number is about this repository, not about consumers

`pnpm audit --audit-level=moderate` exits 1 with **43 vulnerabilities — 4 low, 19 moderate, 19 high,
1 critical**. That number describes the tree a contributor installs, and it is the wrong number to
quote at a user, because almost all of it arrives through `devDependencies`.

Every platform SDK is an **optional peer** of its adapter. `plivo`, `twilio`, `@vonage/server-sdk`,
`discord.js`, `matrix-js-sdk` and the rest are declared `peerDependenciesMeta: { optional: true }`
and installed here only as devDependencies so the adapters can be built and tested. A consumer gets
one of them only by choosing that provider and installing it themselves.

Measured against the registry rather than the lockfile:

| Installed | Advisories |
|---|---|
| `@theokit/gateway`, `@theokit/gateway-sms`, `@theokit/gateway-telegram` | **0** |
| all eleven published packages | **2 high**, both the same nodemailer advisory via `@theokit/gateway-email` |

The critical is not among them.

## The critical — `form-data <2.5.4`

Reached by `packages/gateway-sms > plivo > request > form-data`. `plivo@4.79.0`, the latest, still
depends on `request@^2.88.2`, which is deprecated and unmaintained, so no version bump clears it.

It never reached a consumer: `plivo` is an optional peer, so a user who does not use Plivo never
installs it, and a user who does installs Plivo's own tree rather than ours.

For this repository's own tree there is a `pnpm.overrides` entry pinning `form-data` to `>=2.5.4`.
Verified after regenerating the lockfile: `pnpm-lock.yaml` resolves `request@2.88.2`'s `form-data`
to `4.0.6`, no entry anywhere resolves below `2.5.4`, and `pnpm audit` drops from 43 findings to 41
with no critical.

**An override does nothing until the lockfile is regenerated.** The first version of this document
claimed the fix was verified when it was not: the check had read plivo's own direct `form-data`
dependency, which was already 4.0.6, rather than the one under `request`, which was 2.3.3. The
sentence then explained the still-failing audit away as a tooling artifact — an unfixed finding
reported as closed, in a security document. The lesson is the check, not the override: read the
resolution under the *path the advisory names*, and confirm the audit count moves.

## The two that do reach a consumer — nodemailer

Both are the same advisory, "Message-level raw option bypasses disableFileAccess/disableUrlAccess",
against `nodemailer <=9.0.0`.

`@theokit/gateway-email` declared `nodemailer ^8.0.0` as a peer. The whole of `^8` is inside the
vulnerable range, so a consumer following our range got a vulnerable nodemailer and one who wanted a
safe one got a peer conflict. The peer is now `^9.0.1`; nodemailer 9 keeps `createTransport`,
`sendMail`, `verify` and `close`, which is the entire surface this adapter uses, and the adapter's
95 tests pass against it.

The advisory's subject — a message-level `raw` option on send — is not a path this adapter uses; it
parses inbound mail. The peer moved anyway, because a range that admits only vulnerable versions is
a defect whether or not we reach the vulnerable code.

## What remains, and why it is recorded rather than fixed

The other 19 high and 19 moderate advisories are in devDependency trees: platform SDKs and their
transitive dependencies, none of which a consumer installs through us. They are worth watching and
they are not worth blocking a release on, because the release does not carry them.

The way to check what a consumer actually receives is to install the published packages in an empty
directory and audit that — not to read the number from this repository's lockfile.
