/**
 * splitForTeams tests (T3.1 + EC-8 pattern + UTF-16 surrogate guard).
 */

import { describe, expect, it } from "vitest";

import { splitForTeams } from "../src/split.js";

describe("splitForTeams", () => {
  it("test_split_under_8000_returns_single", () => {
    expect(splitForTeams("short message")).toEqual(["short message"]);
  });

  it("test_split_breaks_at_double_newline", () => {
    const p1 = "a".repeat(5000);
    const p2 = "b".repeat(5000);
    const out = splitForTeams(`${p1}\n\n${p2}`);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(p1);
    expect(out[1]).toBe(p2);
  });

  it("test_split_breaks_at_single_newline_when_no_double", () => {
    const p1 = "a".repeat(6000);
    const p2 = "b".repeat(4000);
    const out = splitForTeams(`${p1}\n${p2}`);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]).toBe(p1);
  });

  it("test_split_hard_cut_at_8000_when_no_boundary", () => {
    const text = "a".repeat(20_000);
    const out = splitForTeams(text);
    for (const part of out) {
      expect(part.length).toBeLessThanOrEqual(8000);
    }
    expect(out.join("")).toBe(text);
  });

  it("test_split_preserves_surrogate_pairs — no orphan low surrogate", () => {
    const text = `${"a".repeat(7999)}😀${"b".repeat(100)}`;
    const out = splitForTeams(text);
    for (const part of out) {
      const firstCode = part.charCodeAt(0);
      expect(firstCode >= 0xdc00 && firstCode <= 0xdfff).toBe(false);
    }
  });

  it("test_split_filters_empty_parts — consecutive newlines", () => {
    expect(splitForTeams("\n\n\n\n")).toEqual([]);
    expect(splitForTeams("   ")).toEqual([]);
  });

  it("preserves single short text", () => {
    expect(splitForTeams("hi")).toEqual(["hi"]);
  });
});

describe("splitForTeams — the boundaries and the fallback, which nothing pinned", () => {
  it("breaks at a space when there is no newline anywhere", () => {
    // Teams allows 8000 characters, so reaching the cap takes a long answer — and a long answer
    // pasted as one block is exactly the shape with no newline to break on. The space boundary was
    // the only rung nothing exercised.
    const head = "a".repeat(6000);

    expect(splitForTeams(`${head} ${"b".repeat(4000)}`)[0]).toBe(head);
  });

  it("prefers the last boundary over filling the window", () => {
    // A boundary a quarter of the way in is still preferred over a full window: half a word split
    // across two Teams messages renders as two words, and no reader can tell it was one.
    const head = "a".repeat(2000);

    expect(splitForTeams(`${head} ${"b".repeat(8000)}`)[0]).toBe(head);
  });
});
