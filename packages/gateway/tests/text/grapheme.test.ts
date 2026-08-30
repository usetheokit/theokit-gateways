/**
 * Golden tests for `chunkByGrapheme` (roadmap M1).
 *
 * Embeds verbatim copies of the pre-migration `splitForLine` / `splitForSMS`
 * grapheme walks as reference oracles and asserts `chunkByGrapheme` (plus the
 * SMS prefix applied by the wrapper) reproduces them byte-for-byte across a
 * deterministic corpus.
 */

import { describe, expect, it } from "vitest";

import { chunkByGrapheme } from "../../src/text/chunk.js";

// --- Reference oracles (verbatim pre-M1 logic) -----------------------------

function oracleLine(text: string, limit = 5000): string[] {
  if (text.length === 0) return [""];
  if (text.length <= limit) return [text];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = Array.from(segmenter.segment(text), (s) => s.segment);
  const parts: string[] = [];
  let buf = "";
  for (const seg of segments) {
    if (buf.length + seg.length > limit) {
      if (buf.length > 0) parts.push(buf);
      buf = "";
    }
    buf += seg;
  }
  if (buf.length > 0) parts.push(buf);
  return parts;
}

function oracleSMS(text: string, limit = 1600): string[] {
  const PART_PREFIX_RESERVED = 8;
  if (text.length === 0) return [""];
  if (text.length <= limit) return [text];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = Array.from(segmenter.segment(text), (s) => s.segment);
  const parts: string[] = [];
  const cap = limit - PART_PREFIX_RESERVED;
  let buf = "";
  for (const seg of segments) {
    if (buf.length + seg.length > cap) {
      if (buf.length > 0) parts.push(buf);
      buf = "";
    }
    buf += seg;
  }
  if (buf.length > 0) parts.push(buf);
  if (parts.length === 1) return parts;
  const total = parts.length;
  return parts.map((p, i) => `(${i + 1}/${total}) ${p}`);
}

// --- chunkByGrapheme configured per family ---------------------------------

const lineViaCore = (t: string) => chunkByGrapheme(t, { limit: 5000 });

const smsViaCore = (t: string): string[] => {
  const parts = chunkByGrapheme(t, { limit: 1600, partLimit: 1600 - 8 });
  if (parts.length <= 1) return parts;
  const total = parts.length;
  return parts.map((p, i) => `(${i + 1}/${total}) ${p}`);
};

function makeCorpus(): string[] {
  const corpus: string[] = ["", "short", "🇯🇵🇯🇵 regional indicators", "a̐éö̲ combining"];
  const word = "the quick brown fox 🦊 ";
  for (const size of [1592, 1593, 1599, 1600, 1601, 3200, 4999, 5000, 5001, 12000]) {
    let s = "";
    while (s.length < size) s += word;
    corpus.push(s.slice(0, size));
    corpus.push("x".repeat(size));
  }
  // Grapheme straddling the SMS cap (1592): 😀 = 2 UTF-16 units at the boundary.
  corpus.push(`${"x".repeat(1591)}😀${"y".repeat(50)}`);
  return corpus;
}

const CORPUS = makeCorpus();

describe("chunkByGrapheme — input validation (fail fast)", () => {
  // The message is asserted, not just the type. `rules/error-handling.md` § 2 requires a typed error
  // WITH the context to act on it, and `rules/testing.md` § 4.1 says a negative case asserts the
  // specific error and message rather than merely that something throws. Both calls below raise the
  // same RangeError from the same helper, so only the label distinguishes "which argument was wrong"
  // — and a caller reading `must be a positive integer, received 0` cannot act on it without one.
  it("throws on non-positive limit", () => {
    expect(() => chunkByGrapheme("abc", { limit: 0 })).toThrow(
      /^chunkByGrapheme: limit must be a positive integer, received 0$/,
    );
    expect(() => chunkByGrapheme("abc", { limit: -1 })).toThrow(RangeError);
  });
  it("throws on non-positive partLimit", () => {
    expect(() => chunkByGrapheme("abc", { limit: 100, partLimit: 0 })).toThrow(
      /^chunkByGrapheme: partLimit must be a positive integer, received 0$/,
    );
  });
  it("accepts a valid partLimit below limit", () => {
    expect(() => chunkByGrapheme("abc", { limit: 100, partLimit: 92 })).not.toThrow();
  });
});

describe("chunkByGrapheme — fast paths", () => {
  it("empty string → single empty chunk", () => {
    expect(chunkByGrapheme("", { limit: 100 })).toEqual([""]);
  });
  it("short text unchanged", () => {
    expect(chunkByGrapheme("hi", { limit: 100 })).toEqual(["hi"]);
  });
});

describe("chunkByGrapheme reproduces the adapter oracles byte-for-byte", () => {
  it("LINE (limit 5000)", () => {
    for (const t of CORPUS) expect(lineViaCore(t)).toEqual(oracleLine(t));
  });
  it("SMS (limit 1600, reserved prefix, (i/N))", () => {
    for (const t of CORPUS) expect(smsViaCore(t)).toEqual(oracleSMS(t));
  });
});

describe("chunkByGrapheme — never severs a grapheme", () => {
  it("keeps 🦊 (surrogate pair) intact across chunk edges", () => {
    const text = `${"🦊".repeat(2000)}`; // each 🦊 = 2 UTF-16 units
    const parts = chunkByGrapheme(text, { limit: 1000 });
    for (const c of parts) {
      const last = c.charCodeAt(c.length - 1);
      const first = c.charCodeAt(0);
      // Both ends. A severed pair leaves a trailing HIGH surrogate on one chunk and a leading LOW
      // surrogate on the next, so checking only the tail sees half of every break.
      expect(last >= 0xd800 && last <= 0xdbff, "chunk ends on a lone high surrogate").toBe(false);
      expect(first >= 0xdc00 && first <= 0xdfff, "chunk starts on a lone low surrogate").toBe(
        false,
      );
    }
    expect(parts.join(""), "rejoining the chunks did not reproduce the input").toBe(text);
  });

  it("emits an oversized part rather than severing a grapheme that cannot fit", () => {
    // 👨‍👩‍👧‍👦 is ONE grapheme of 11 UTF-16 units. With partLimit 5 it fits in no part at all, which is the
    // only input where the walk reaches its `buf` push with nothing buffered. The contract has to
    // give somewhere, and it gives on the limit, never on the grapheme: SMS would rather send one
    // part over its window than a part ending in half a family. Nothing stated that until now, so
    // dropping the empty-buffer guard — emitting a phantom "" part before every oversized one — was
    // invisible, and an adapter counting parts for its `(i/N)` prefix would have counted the phantom.
    const family = "👨‍👩‍👧‍👦";
    const parts = chunkByGrapheme(family.repeat(3), { limit: 5, partLimit: 5 });
    expect(parts).toEqual([family, family, family]);
    expect(
      parts.every((p) => p.length > 0),
      "an empty part was emitted",
    ).toBe(true);
  });
});
