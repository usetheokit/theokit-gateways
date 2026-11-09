import { describe, expect, it } from "vitest";

import { splitForLine } from "../src/split.js";

/**
 * B-556 FR-008, AC-004: the parts splitForLine returns for text with no table row, pinned while
 * the splitter was still the one at 688c322 (lengths from the discovery's Q6 probe and a run of the
 * unchanged splitter). The row rule must leave every one of these arrays as it is.
 */

function paragraphs(minLength: number): string {
  const lines: string[] = [];
  let length = 0;
  for (let i = 0; length < minLength; i += 1) {
    const next = `Paragraph ${i}: ${"lorem ipsum dolor sit amet ".repeat(7).trim()}.`;
    length += next.length + (lines.length > 0 ? 2 : 0);
    lines.push(next);
  }
  return lines.join("\n\n");
}

function sentencesWithPipes(minLength: number): string {
  const lines: string[] = [];
  let length = 0;
  for (let i = 0; length < minLength; i += 1) {
    const next = `Sentence ${i} keeps a | mid-line, then a b | c pair, and ends here.`;
    length += next.length + (lines.length > 0 ? 1 : 0);
    lines.push(next);
  }
  return lines.join("\n");
}

describe("splitForLine on text with no table row", () => {
  it("splits prose of 2.5x the limit into the parts it gave at 688c322", () => {
    const text = paragraphs(12500);
    const parts = splitForLine(text);
    expect(text.length).toBe(12698);
    expect(parts.map((part) => part.length)).toEqual([5000, 5000, 2698]);
    expect(parts.join("")).toBe(text);
  });

  it("splits sentences holding mid-line pipes into the parts it gave at 688c322", () => {
    const text = sentencesWithPipes(12500);
    const parts = splitForLine(text);
    expect(text.length).toBe(12552);
    expect(parts.map((part) => part.length)).toEqual([5000, 5000, 2552]);
    expect(parts.join("")).toBe(text);
  });
});
