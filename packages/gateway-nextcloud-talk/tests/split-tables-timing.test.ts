import { describe, expect, it } from "vitest";

import { splitForTalk } from "../src/split.js";

/** `splitForTalk` as it was at 688c322: slices of 32000 code points. */
function splitWithoutRowRule(text: string, limit = 32_000): string[] {
  const codePoints = Array.from(text);
  const parts: string[] = [];
  for (let at = 0; at < codePoints.length; at += limit) {
    parts.push(codePoints.slice(at, at + limit).join(""));
  }
  return parts;
}

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

/**
 * Fastest time of new over fastest time of old, across `pairs` interleaved timings after one
 * warm-up call of each. Load and GC pauses only add time, so the fastest timing of each function
 * is the one least moved by them. A median of ratios does not work here: the two splitters do
 * about the same work, so the true ratio is near 1.0, and review round 1 measured single-pair
 * ratios from 0.5 to 1.9 at a load average of 5 to 17.
 */
function fastestRatio(oldFn: () => unknown, newFn: () => unknown, pairs: number): number {
  let oldBest = Number.POSITIVE_INFINITY;
  let newBest = Number.POSITIVE_INFINITY;
  oldFn();
  newFn();
  for (let k = 0; k < pairs; k += 1) {
    oldBest = Math.min(oldBest, timePerCall(oldFn, 500));
    newBest = Math.min(newBest, timePerCall(newFn, 500));
  }
  return newBest / oldBest;
}

describe("splitForTalk timing against the 688c322 splitter", () => {
  // One call of either splitter took about 150 ms on this table in review round 1, so five pairs
  // of 500 ms budgets take about 5 s, past vitest's 5000 ms default; the 120 s budget is the
  // plan's (panel round 2, N4 and C5) and is slack here, not need.
  it("stays within 1.5x on a 1,000,000-character table", { timeout: 120_000 }, () => {
    const text = tableOfLength(1_000_000);
    const ratio = fastestRatio(
      () => splitWithoutRowRule(text),
      () => splitForTalk(text),
      5,
    );
    expect(ratio).toBeLessThanOrEqual(1.5);
  });
});
