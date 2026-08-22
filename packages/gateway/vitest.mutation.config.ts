import { defineConfig } from "vitest/config";

/**
 * Vitest config for the Stryker run only — the base config minus `tests/lint/**`.
 *
 * The lint suites are structural gates over the whole monorepo tree, not tests of
 * this package's behaviour: `no-ptbr` walks from `__dirname/../../../..` (the repo
 * root) and `adapter-contract` reads the ten sibling adapters' sources. Both break
 * inside Stryker's sandbox, where the package is copied to `.stryker-tmp/sandbox-*`
 * and those relative climbs land somewhere else entirely.
 *
 * Excluding them is right on the merits, not just a workaround: they READ source
 * text rather than executing it, so no mutant of `chunk.ts` or `executor.ts` can
 * ever be killed by one. Keeping them in would re-walk the tree once per mutant to
 * prove nothing.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/lint/**"],
    environment: "node",
  },
});
