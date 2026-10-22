# ADR-0008: Edit-capable adapters raise their core floor after the core ships

- Status: Accepted
- Date: 2026-10-21
- Deciders: the sprint session, under the sprint's delegated authority, answering review finding
  F-xval-1 of `gateway-preview-streaming` (round 2)
- Supersedes: the "Alternatives considered" line of the item plan's D3, which rejected raising the
  adapters' peer floor at all
- Evidence: commits `b38172b` and `1e215ab`, and `packages/gateway-discord/CHANGELOG.md` (0.2.0 and
  the patch after it)

## Context and Problem Statement

`editMessage` and `supportsEdit` arrive on `BasePlatformAdapter` in the core minor this release
publishes. Telegram, Discord, Slack, Mattermost, Matrix and Teams declare both with `override`,
while their peer range on `@theokit/gateway` is `>=0.9.0 <1.0.0`.

The item's plan (D3) kept the floor at 0.9.0. It argued that self-contained overrides pass
dep-check's floor leg, because no adapter calls `super.editMessage` and "the adapters' test
scripts run no tsc". The implementation found the second half false: the floor leg builds each
package with type declarations before the suite runs, so against core 0.9.0 the six `override`
members fail TS4113, and without `override` they fail TS4114 against the workspace core.

So the floor has to rise. D3 rejected that because a range cannot name a version that is not on
npm yet. The question is when it rises.

## Decision

The six adapters' peer floor rises to the core minor this release publishes, in the release that
follows it, once that core is on npm. This is the shape `1e215ab` used for 0.9.0.

Until then the adapters keep `>=0.9.0`. At run time they work against any core in that range,
because none of them calls the base `editMessage` (D3 holds there). What does not hold is building
their sources against an older core, which is what the floor leg measures.

## Alternatives considered

- **Raise the floor in the version commit of this release.** This is what `b38172b` announced for
  0.9.0, and it is not what happened: the floor was closed one release later in `1e215ab`, because
  dep-check's install check packs an adapter and installs it as a consumer would, and no consumer
  can resolve a floor that names a core not yet on npm. Rejected on that evidence.
- **Keep the floor at 0.9.0 for good and accept a red floor leg.** Rejected: a gate is not
  switched off or ignored to pass.
- **Turn off `noImplicitOverride` in the six adapters.** Rejected: it loosens a compiler gate
  to answer a question about versions.
- **Drop `override` from the six members.** Rejected: TS4114 against the workspace core.

## Consequences

- The release that publishes the core with `editMessage` is followed by a release that raises the
  six floors. `/release` owns both cuts and how the floor leg reads on the first one; this record
  does not settle that, and the item's implementation record names it as owed.
- Between the two releases a consumer on an older core inside the range who installs a new
  adapter gets a working adapter whose sources would not build against that core. Their own
  typecheck reads the published declarations, which carry no `override`, and passes.
- The changeset `gateway-edit-message.md` states the floor the packages declare and points here.
