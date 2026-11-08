import { chunkByGrapheme } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { splitForLine } from "../src/split.js";

/** `splitForLine` as it was at 688c322. */
const splitWithoutRowRule = (text: string): string[] => chunkByGrapheme(text, { limit: 5000 });

/**
 * B-556 NFR-002, AC-005: keeping table rows whole costs at most 1.5x the time the 688c322
 * splitter took on a 1,000,000-character table. A same-run ratio, because absolute times move with
 * the machine's load; the two functions are timed in interleaved pairs so both see the same load.
 */

const plainRow = (i: number): string =>
  `| ${i} | item-${i} | ${1000 + i} | plain text cell number ${i} |`;

/** A table of at least `minLength` characters, its length summed as it grows. */
function tableOfLength(minLength: number): string {
  const header = "| id | name | value | note |";
  const separator = "|---|:---:|---:|---|";
  const lines = [header, separator];
  let length = header.length + 1 + separator.length;
  for (let i = 0; length < minLength; i += 1) {
    const next = plainRow(i);
    lines.push(next);
    length += next.length + 1;
  }
  return lines.join("\n");
}

/** Mean time of one call of `fn`, repeating it until `budgetMs` has passed. */
function timePerCall(fn: () => unknown, budgetMs: number): number {
  let calls = 0;
  const start = performance.now();
  do {
    fn();
    calls += 1;
  } while (performance.now() - start < budgetMs);
  return (performance.now() - start) / calls;
}

/** Median of `pairs` interleaved ratios new / old, after one warm-up call of each. */
function medianRatio(oldFn: () => unknown, newFn: () => unknown, pairs: number): number {
  const ratios: number[] = [];
  oldFn();
  newFn();
  for (let k = 0; k < pairs; k += 1) {
    const old = timePerCall(oldFn, 500);
    ratios.push(timePerCall(newFn, 500) / old);
  }
  ratios.sort((x, y) => x - y);
  return ratios[Math.floor(pairs / 2)] ?? Number.POSITIVE_INFINITY;
}

describe("splitForLine timing against the 688c322 splitter", () => {
  // The 688c322 copy took 2.3 to 3.9 s per call on this table under load, so three pairs run
  // past vitest's 5000 ms default; the budget is the plan's (panel round 2, N4 and C5).
  it("stays within 1.5x on a 1,000,000-character table", { timeout: 120_000 }, () => {
    const text = tableOfLength(1_000_000);
    const ratio = medianRatio(
      () => splitWithoutRowRule(text),
      () => splitForLine(text),
      3,
    );
    expect(ratio).toBeLessThanOrEqual(1.5);
  });
});
