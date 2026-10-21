// The 4-to-0 figure B-018 ships on, measured on the two fixtures themselves (alignment AC-007).
//
// `measure-app-joinery-compare.test.mjs` checks the --compare output on samples of its own, so a
// fixture edit or a detector change could move the figure with no test noticing. These read the
// committed fixtures: the hand-wired one must keep exactly its four joins, and the descriptor-wired
// one must name no platform and reach no relative module.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { countPlatformBranches } from "../lib/platform-branches.mjs";

function sitesOf(fixture) {
  const file = fileURLToPath(
    new URL(`../../integration/tests/unit/fixtures/channel-wiring/${fixture}`, import.meta.url),
  );
  return countPlatformBranches(readFileSync(file, "utf8"), { fileName: file }).sites;
}

describe("the channel-wiring fixtures", () => {
  it("count the four hand-wired joins by kind", () => {
    expect(sitesOf("hand-wired.ts").map((site) => site.kind)).toEqual([
      "construct",
      "construct",
      "call",
      "platform_method",
    ]);
  });

  it("count no site in the descriptor-wired fixture", () => {
    expect(sitesOf("descriptor-wired.ts")).toEqual([]);
  });
});
