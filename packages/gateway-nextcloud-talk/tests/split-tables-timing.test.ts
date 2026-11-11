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

/**
 * CPU time (user + system, ms) one call of `fn` used. CPU time, not wall-clock: a descheduled
 * process stops accruing it, so a loaded host moves it far less than it moves `performance.now()`.
 */
function timePerCall(fn: () => unknown): number {
  const before = process.cpuUsage();
  fn();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

/**
 * Fastest time of new over fastest time of old, across interleaved single-call timings after one
 * warm-up call of each. Load and GC pauses only add time, so the fastest timing of each function
 * is the one least moved by them. A median of ratios does not work here: the two splitters do
 * about the same work, so the true ratio is near 1.0, and review round 1 measured single-pair
 * ratios from 0.5 to 1.9 at a load average of 5 to 17.
 */
function fastestRatio(oldFn: () => unknown, newFn: () => unknown, windowMs: number): number {
  let oldBest = Number.POSITIVE_INFINITY;
  let newBest = Number.POSITIVE_INFINITY;
  const start = performance.now();
  oldFn();
  newFn();
  // Single calls, interleaved, for as long as the window lasts (at least one pair): more
  // samples is what finds an undisturbed one under load, and the window keeps the test inside
  // vitest's default 5 s timeout.
  for (let k = 0; k < 1 || performance.now() - start < windowMs; k += 1) {
    oldBest = Math.min(oldBest, timePerCall(oldFn));
    newBest = Math.min(newBest, timePerCall(newFn));
  }
  return newBest / oldBest;
}

describe("splitForTalk timing against the 688c322 splitter", () => {
  it("stays within 1.5x on a 1,000,000-character table", () => {
    const text = tableOfLength(1_000_000);
    const ratio = fastestRatio(
      () => splitWithoutRowRule(text),
      () => splitForTalk(text),
      2_500,
    );
    expect(ratio).toBeLessThanOrEqual(1.5);
  });
});
