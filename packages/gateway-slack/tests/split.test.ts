/**
 * Tests for splitForSlack — boundaries, paragraph/word breaks, surrogate guard (EC-4).
 */

import { describe, expect, it } from "vitest";
import { splitForSlack } from "../src/split.js";

describe("splitForSlack", () => {
  it("returns a single chunk for short text", () => {
    expect(splitForSlack("hello")).toEqual(["hello"]);
  });

  it("returns one chunk at exactly 4000 chars", () => {
    const text = "a".repeat(4000);
    expect(splitForSlack(text)).toEqual([text]);
  });

  it("splits text over 4000 chars into 2+ chunks", () => {
    const text = "a".repeat(4001);
    const chunks = splitForSlack(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
  });

  it("prefers paragraph break (\\n\\n)", () => {
    const a = "a".repeat(3000);
    const b = "b".repeat(2000);
    const chunks = splitForSlack(`${a}\n\n${b}`);
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b);
  });

  it("falls back to line break (\\n)", () => {
    const a = "a".repeat(3500);
    const b = "b".repeat(1000);
    const chunks = splitForSlack(`${a}\n${b}`);
    expect(chunks[0]?.startsWith("a")).toBe(true);
    expect(chunks[chunks.length - 1]?.endsWith("b")).toBe(true);
  });

  it("falls back to word break (space)", () => {
    const segment = "word ".repeat(900); // ~4500 chars
    const chunks = splitForSlack(segment);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
  });

  it("each chunk is under 4000 chars", () => {
    const text = "lorem ipsum dolor sit amet ".repeat(500);
    const chunks = splitForSlack(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
  });

  it("EC-4: avoids cutting inside a UTF-16 surrogate pair (emoji)", () => {
    // The offset is the whole test. At 3998 the emoji occupies indices
    // 3998-3999, so 3998 + 2 <= 4000 and the cut never falls between the
    // surrogates — the guard was never exercised, and removing
    // `surrogateGuard: true` from src/split.ts left this test green while
    // shipping severed emoji to Slack.
    //
    // At 3999 the pair straddles the window edge: index 3999 is the high
    // surrogate, 4000 the low one, so a naive cut at 4000 splits it. This is the
    // offset the core test (gateway/tests/text/chunk.test.ts:142) uses, and the
    // one that distinguishes a guarded chunker from an unguarded one.
    const prefix = "a".repeat(3999);
    const text = `${prefix}🎉${"b".repeat(100)}`;
    const chunks = splitForSlack(text);
    for (const c of chunks) assertNoLoneSurrogate(c);
  });

  it("EC-4: the guard is what keeps the pair intact, not the corpus", () => {
    // Guards the guard. `assertNoLoneSurrogate` passes vacuously on text with no
    // surrogates at all, so this asserts the emoji actually survives somewhere,
    // whole, rather than merely never appearing severed.
    const text = `${"a".repeat(3999)}🎉${"b".repeat(100)}`;
    const chunks = splitForSlack(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("🎉");
  });
});

/** Assert every high surrogate in `c` is followed by a low surrogate. */
function assertNoLoneSurrogate(c: string): void {
  for (let i = 0; i < c.length; i += 1) {
    const code = c.charCodeAt(i);
    if (code < 0xd800 || code > 0xdbff) continue;
    const next = c.charCodeAt(i + 1);
    expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
  }
}

describe("splitForSlack — the boundaries and the fallback, which nothing pinned", () => {
  it("breaks at a space when there is no newline anywhere", () => {
    // Slack's 4000-character cap is the tightest of the chat platforms, so an ordinary answer of a
    // few paragraphs reaches it. Emptying `" "` in `boundaries` killed no test, and it is the only
    // break point a single unbroken paragraph has.
    const head = "a".repeat(3000);

    expect(splitForSlack(`${head} ${"b".repeat(2000)}`)[0]).toBe(head);
  });

  it("prefers the last boundary over filling the window", () => {
    // With the only space 1000 in, `last-boundary` breaks there and leaves 3000 of the window
    // unused rather than cutting a word. Every existing case put its boundary near the limit, so
    // the setting could be emptied unnoticed.
    const head = "a".repeat(1000);

    expect(splitForSlack(`${head} ${"b".repeat(4000)}`)[0]).toBe(head);
  });
});
