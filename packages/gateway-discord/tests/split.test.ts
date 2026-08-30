/**
 * Pin test for `splitForDiscord` (roadmap M0, step 4).
 *
 * Captures the CURRENT behavior before the M1 migration onto core `chunkText`,
 * so the conversion can be proven output-identical. Discord's shape is the
 * Telegram family: 2000 hard cap, 1900 soft window, `\n\n` → `\n` → window
 * boundary preference, newline-only leading strip, no surrogate guard.
 */

import { describe, expect, it } from "vitest";

import { splitForDiscord } from "../src/split.js";

describe("splitForDiscord", () => {
  it("returns short text unchanged as a single chunk", () => {
    expect(splitForDiscord("hello")).toEqual(["hello"]);
    expect(splitForDiscord("")).toEqual([""]);
  });

  it("returns text at exactly the 2000 cap as a single chunk", () => {
    const t = "a".repeat(2000);
    expect(splitForDiscord(t)).toEqual([t]);
  });

  it("splits a boundary-less block at the 1900 soft window", () => {
    const t = "x".repeat(2500);
    const parts = splitForDiscord(t);
    expect(parts).toEqual(["x".repeat(1900), "x".repeat(600)]);
  });

  it("prefers a paragraph boundary and strips leading newlines on continuation", () => {
    const head = "p".repeat(1800);
    const tail = "q".repeat(400);
    const parts = splitForDiscord(`${head}\n\n${tail}`);
    expect(parts).toEqual([head, tail]);
  });

  it("falls back to a single newline when there is no paragraph break", () => {
    // The second boundary, and the only one no test used: emptying `"\n"` in `boundaries` killed
    // nothing. It is what a code block or a list — text with line breaks but no blank line, the
    // ordinary shape of a Discord message — actually breaks on.
    const head = "p".repeat(1800);
    const tail = "q".repeat(400);

    expect(splitForDiscord(`${head}\n${tail}`)).toEqual([head, tail]);
  });

  it("strips newlines only at the START of a continuation, never inside it", () => {
    // `stripLeading: /^\n+/`. Dropping the `^` turns it into "remove the first newline run
    // ANYWHERE", which silently glues two lines together in the continuation of every message long
    // enough to split. Measured: it changes this exact case by one character, and no test in this
    // file had a continuation that began with text and carried a newline further in.
    //
    // The newline sits at 1950 — past the 1900 soft window, so the cut is the window and the
    // continuation opens with text rather than with the break.
    const parts = splitForDiscord(`${"a".repeat(1950)}\n${"b".repeat(500)}`);

    expect(parts[1], "an internal newline was eaten by the leading-newline strip").toBe(
      `${"a".repeat(50)}\n${"b".repeat(500)}`,
    );
  });

  it("never emits a chunk longer than the 2000 hard cap", () => {
    for (const size of [1901, 2000, 2001, 3800, 5000, 9999]) {
      const t = "abc def ".repeat(Math.ceil(size / 8)).slice(0, size);
      for (const c of splitForDiscord(t)) expect(c.length).toBeLessThanOrEqual(2000);
    }
  });
});
