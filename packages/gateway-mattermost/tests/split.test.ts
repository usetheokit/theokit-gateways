/**
 * Tests for `splitForMattermost`.
 *
 * This file exists because the package had no splitting at all — `sendMessage`
 * posted `out.text` whole, alone among the ten adapters. Nothing here could have
 * caught that: there was no cap in the code to write a test against. It took a
 * real Mattermost server answering
 *
 *   HTTP 400 — "Post Message property is longer than the maximum permitted length."
 *
 * to show it. The numbers below are measured against that server, not read off a
 * doc page: 16000 chars posted fine, 16384 was refused.
 */

import { describe, expect, it } from "vitest";

import { splitForMattermost } from "../src/split.js";

const CAP = 16_383;

describe("splitForMattermost", () => {
  it("returns short text as a single part", () => {
    expect(splitForMattermost("hello")).toEqual(["hello"]);
  });

  it("returns text at the cap as a single part", () => {
    const text = "x".repeat(CAP);
    expect(splitForMattermost(text)).toHaveLength(1);
  });

  it("splits text past the cap, and every part fits", () => {
    // The regression itself: one part over the limit is an HTTP 400 the user
    // never sees.
    const parts = splitForMattermost("x".repeat(50_000));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(CAP);
    }
  });

  it("loses no characters", () => {
    // Chunks are cut, never edited. A dropped character is silent data loss in
    // an agent's reply.
    const text = "x".repeat(40_000);
    expect(splitForMattermost(text).join("")).toBe(text);
  });

  it("prefers a paragraph boundary over cutting mid-word", () => {
    const parts = splitForMattermost("paragraph one.\n\n".repeat(2_000));
    expect(parts.length).toBeGreaterThan(1);
    let checked = 0;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const tail = parts[i]?.slice(-1) ?? "";
      expect(/[a-z]/.test(tail)).toBe(false);
      checked += 1;
    }
    // Guards the guard: if the corpus ever falls under the cap this fails
    // rather than silently asserting nothing.
    expect(checked).toBeGreaterThan(0);
  });

  it("terminates on text with no boundary at all", () => {
    // A single unbroken run has nowhere preferred to cut; it must still finish.
    const parts = splitForMattermost("x".repeat(100_000));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length > 0)).toBe(true);
  });

  it("handles empty text without inventing a part", () => {
    expect(splitForMattermost("")).toEqual([""]);
  });
});

describe("splitForMattermost — the boundaries and the fallback, which nothing pinned", () => {
  it("breaks at a space when there is no newline anywhere", () => {
    // The third boundary in the list, and the only one no test exercised: emptying `" "` killed
    // nothing. It is the break point of a long paragraph with no line breaks — the ordinary shape
    // of a chat message — and without it a word is cut in half.
    const head = "a".repeat(12000);

    expect(splitForMattermost(`${head} ${"b".repeat(8000)}`)[0]).toBe(head);
  });

  it("prefers the last boundary over filling the window", () => {
    // `lastResort: "last-boundary"`. Measured: with the only space 4000 characters in, this setting
    // breaks there and leaves the rest of the window unused, where the fallback fills the window
    // and cuts mid-word. Every existing case had its boundary near the limit or none at all, so
    // the two were indistinguishable and the setting was free to be emptied.
    const head = "a".repeat(4000);

    expect(splitForMattermost(`${head} ${"b".repeat(16000)}`)[0]).toBe(head);
  });
});
