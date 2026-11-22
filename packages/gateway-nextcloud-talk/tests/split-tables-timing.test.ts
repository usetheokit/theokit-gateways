import { describe, expect, it } from "vitest";

import { splitForTalk } from "../src/split.js";

/**
 * The table with every pipe replaced, so no line reads as a row: `splitForTalk` then runs the same
 * grapheme-aware cut as for the table, minus the row rule. Both calls go through core, so coverage
 * instrumentation slows them alike; the 688c322 splitter (code-point slices, no grapheme work)
 * no longer isolates what the row rule costs.
 */
const withoutRows = (text: string): string => text.replaceAll("|", "!");

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

/**
 * Coverage instrumentation taxes the row rule's per-unit scan far more than the plain cut (measured
 * 1.9x against 1.0x without it), so the ratio only means something on uninstrumented code.
 */
const instrumented =
  (globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: boolean } } } })
    .__vitest_worker__?.config?.coverage?.enabled === true;

describe("splitForTalk timing against a grapheme-aware splitter without the row rule", () => {
  it.skipIf(instrumented)("stays within 1.5x on a 1,000,000-character table", () => {
    const text = tableOfLength(1_000_000);
    const plain = withoutRows(text);
    const ratio = fastestRatio(
      () => splitForTalk(plain),
      () => splitForTalk(text),
      2_500,
    );
    expect(ratio).toBeLessThanOrEqual(1.5);
  });
});
