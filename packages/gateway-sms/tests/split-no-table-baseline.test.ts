import { describe, expect, it } from "vitest";

import { splitForSMS } from "../src/split.js";

/**
 * B-556 FR-008, AC-004: the parts splitForSMS returns for text with no table row, pinned while
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

const withoutPrefix = (part: string): string => part.replace(/^\(\d+\/\d+\) /, "");

describe("splitForSMS on text with no table row", () => {
  it("splits prose of 2.5x the limit into the parts it gave at 688c322", () => {
    const text = paragraphs(4000);
    const parts = splitForSMS(text);
    expect(text.length).toBe(4088);
    expect(parts.map((part) => part.length)).toEqual([1600, 1600, 906]);
    expect(parts.map(withoutPrefix).join("")).toBe(text);
  });

  it("splits sentences holding mid-line pipes into the parts it gave at 688c322", () => {
    const text = sentencesWithPipes(4000);
    const parts = splitForSMS(text);
    expect(text.length).toBe(4015);
    expect(parts.map((part) => part.length)).toEqual([1600, 1600, 833]);
    expect(parts.map(withoutPrefix).join("")).toBe(text);
  });
});
