# ADR-0009: New adapters publish in the release after the core that names their platform

- Status: Accepted
- Date: 2026-10-22
- Deciders: the sprint session, under the sprint's delegated authority, answering review finding
  F-arch-2 of `s-003-theokit-gateways-evolve-batch` (round 1)
- Related: ADR-0008 (the same question for six existing adapters), commit `1e215ab`
- Packages: `@theokit/gateway-signal`, `@theokit/gateway-imessage`, `@theokit/gateway-google-chat`,
  `@theokit/gateway-irc`, `@theokit/gateway-nextcloud-talk`

## Context and Problem Statement

The five packages are first releases. Each declares the peer range
`"@theokit/gateway": ">=0.12.0 <1.0.0"`, because the item plan's D1 sets each new package's floor
at the first core version that carries its platform key.

On 2026-10-22, `npm view @theokit/gateway versions` ends at `0.11.0`, and the workspace core is
`0.11.0` with minor changesets pending. dep-check's install check packs an adapter and installs it
as a consumer would, and runs on the pull request into `main`. ADR-0008 and `1e215ab` record that
check refusing a floor that names a core not yet on npm. Nothing about these five packages makes
that check behave differently, so a release cut that carries the core minor and the five packages
together reaches the same refusal.

ADR-0008 answered it by keeping the old floor for one more release. That answer is not open here,
so the question is which floor is installable and true.

## Decision

The five packages keep `>=0.12.0 <1.0.0`. They publish in the first release cut after
`@theokit/gateway` 0.12.0 (the minor these changesets produce) is on npm, not in the cut that
publishes that core. This is the sequence `1e215ab` used for 0.9.0: core first, then what needs it.

## Why no lower floor is installable and true

Each statement below was checked on 2026-10-22.

- `git show '@theokit/gateway@0.11.0:packages/gateway/src/adapter/base.ts'` line 55 declares
  `abstract readonly platform: PlatformName`, and 0.11.0's `PlatformName` has none of the five
  keys. Each adapter's `readonly platform = "signal" as const` (and the four siblings) does not
  typecheck against it, which is what dep-check's floor leg builds.
- Four of the adapters call `channelRendering(this.platform)` for markdown, and 0.11.0's table
  has no row for their key.
- The Google Chat and Nextcloud Talk routes pass `rawBodyCapture(tag, { maxBytes })`, which first
  appears in this release's core (changeset `raw-body-capture-max-bytes.md`). Against 0.11.0 the
  option would be ignored and the body would be held with no limit.

So `>=0.11.0` would install and then fail to build, render or bound a body. 0.12.0 is the lowest
version that carries everything the packages use. It is installable from the moment it is on npm.

## Alternatives considered

- **Publish the five packages in the same cut as core 0.12.0.** They would resolve once both are
  published, but the release pull request's install check runs before that and refuses them, the
  failure ADR-0008 records. Rejected: a gate is not switched off or overridden to pass.
- **Declare `>=0.11.0`.** Installable today, false about what the packages need (above), and the
  floor leg fails on the typecheck. Rejected.
- **Have each package augment `PlatformEventRegistry` with its own key so it builds against
  0.11.0.** This reverses the plan's D1 (first-party keys) and still leaves `channelRendering` and
  `maxBytes` missing. Rejected.

## Consequences

- `/release` cuts the core minor without the five packages, then cuts them once 0.12.0 is on npm.
  A package left unpublished costs nothing, since no consumer has a version of it.
- How the first cut holds them back (decided 2026-10-22, answering review finding F-arch-11 of
  round 2, which found the repository set up to publish all six together):
  - Each package's changeset names only its package. What the core gains for that platform (the
    key, the event type, the rendering row) is a core-only changeset, `platform-<package>.md`.
    Changesets refuses a changeset that names an ignored package beside one it versions, so the
    split is what lets the next step work.
  - `.changeset/config.json` lists the five packages in `ignore`, so `changeset version` bumps the
    core to 0.12.0 and leaves the five package changesets pending.
  - Each of the five `package.json` files says `"private": true`. `changeset publish` publishes
    every non-private package whose version is not on npm, ignored or not, so without it the first
    cut would publish the five at `0.0.0`.
- The second cut, once `npm view @theokit/gateway version` prints 0.12.0 or later: remove the five
  names from `ignore`, remove `"private": true` from the five manifests, and run the release. Their
  pending changesets then version each package to 0.1.0, and dep-check's install check resolves
  the 0.12.0 floor from npm. Each package also needs its npm trusted-publisher entry before its
  first publish, as every package in `release.yml` has.
- Until the second cut, the README rows and `integration/` describe packages that exist in the
  repository and not yet on npm.
- If the release runs both in one cut anyway, the install check on its pull request is the gate
  that says so, and it should be read as this decision, not overridden.
