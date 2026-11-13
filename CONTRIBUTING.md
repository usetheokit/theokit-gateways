# Contributing

## Raising the `@theokit/gateway` peer floor

Each adapter declares `peerDependencies["@theokit/gateway"]`. The lower bound must be the first core
version that ships everything the adapter imports (a new helper, a new `channelRendering` platform,
a protected `BasePlatformAdapter` method). When you add a new core import to an adapter, raise the
floor in the same change; find the version in `packages/gateway/CHANGELOG.md`, and note that only
versions published on npm count (there is no 0.13.0). Add a patch changeset for the adapter.
See also ADR-0008.

Check it with `pnpm quality:peer-floor` (build first; needs network access). It packs each adapter,
installs the exact floor version of the core from npm into a temp directory, and imports the adapter.
To try a published pair: `node scripts/check-peer-floor.mjs --adapter @theokit/gateway-zalo@0.1.0 --core 0.12.0`.
