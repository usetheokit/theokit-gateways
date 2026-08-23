// Whether the declaration repair ran over THIS build — the fact that separates a broken
// declaration from an unrepaired one.
//
// `pnpm -r build` runs each package's own build script and stops there. The repair lives in the
// SECOND half of the root script (`pnpm -r run build && node tools/repair-dts-imports.mjs`), so
// the recursive form leaves every declaration in its intermediate state and the gate reports
// `N package(s) publish a declaration that does not compile` — a statement about the published
// artifact, made about something that was never published. Measured cost: one issue filed against
// a defect that did not exist, and a backlog item killed by re-measurement.
//
// The gate already separates "does not compile" from "was never built", on the stated grounds
// that merging different facts "describes a defect that may not exist". This is the same
// distinction, one category over.

import { describe, expect, it } from "vitest";

import { repairRanOverBuild } from "../lib/repair-stamp.mjs";

describe("repairRanOverBuild", () => {
  it("is false when no repair has ever run", () => {
    // No stamp at all: the repair has not run over this dist, and nothing here can claim the
    // declarations are the ones a consumer would receive.
    expect(repairRanOverBuild(undefined, 1_000)).toBe(false);
  });

  it("is false when the build is newer than the last repair", () => {
    // The exact `pnpm -r build` shape: a previous root build stamped it, then a recursive build
    // rewrote the declarations underneath and never re-ran the repair.
    expect(repairRanOverBuild(1_000, 2_000)).toBe(false);
  });

  it("is true when the repair ran after the build finished", () => {
    expect(repairRanOverBuild(2_000, 1_000)).toBe(true);
  });

  it("is true when they share a timestamp", () => {
    // Filesystem mtime granularity can collapse a repair that really did follow its build into
    // the same millisecond. Reading equality as stale would make the hint fire on a correct
    // build, which is the failure mode that matters most: a gate that explains away a REAL
    // breakage is worse than one that is merely unhelpful.
    expect(repairRanOverBuild(1_000, 1_000)).toBe(true);
  });

  it("is false when there are no declarations to have repaired", () => {
    // Nothing built means nothing repaired, whatever the stamp says. The gate reports the
    // unbuilt case separately and this must not contradict it.
    expect(repairRanOverBuild(5_000, undefined)).toBe(false);
  });
});
