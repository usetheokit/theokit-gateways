import { describe, expect, it } from "vitest";
import { splitKeepingRows } from "../../src/text/split-rows.js";

describe("splitKeepingRows", () => {
  it("cuts plain text at the limit", () => {
    expect(splitKeepingRows("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("never severs a grapheme", () => {
    expect(splitKeepingRows("ab🇧🇷cd", 3).join("")).toBe("ab🇧🇷cd");
    expect(splitKeepingRows("ab🇧🇷cd", 3)[0]).toBe("ab");
  });

  it("moves a straddled table row to the next part", () => {
    const text = "intro\n| a | b |\n| c | d |";
    expect(splitKeepingRows(text, 12)).toEqual(["intro\n", "| a | b |\n", "| c | d |"]);
  });
});

describe("splitKeepingRows unit option", () => {
  const emoji = "😀".repeat(10);

  it("counts code points with unit codepoint", () => {
    const parts = splitKeepingRows(emoji, 4, { unit: "codepoint" });
    expect(parts).toEqual(["😀".repeat(4), "😀".repeat(4), "😀".repeat(2)]);
  });

  it("counts UTF-16 units by default", () => {
    expect(splitKeepingRows(emoji, 4).map((p) => [...p].length)).toEqual([2, 2, 2, 2, 2]);
  });

  it("moves a straddled table row whole in codepoint mode", () => {
    const text = "intro😀\n| a | b |\n| c | d |";
    expect(splitKeepingRows(text, 13, { unit: "codepoint" })).toEqual([
      "intro😀\n",
      "| a | b |\n",
      "| c | d |",
    ]);
  });

  it("rejects an unknown unit", () => {
    expect(() => splitKeepingRows("abc", 2, { unit: "bytes" as never })).toThrow(/RangeError|unit/);
    expect(() => splitKeepingRows("abc", 2, { unit: "bytes" as never })).toThrow(RangeError);
  });

  it("rejects a bad limit and an oversized grapheme in codepoint mode", () => {
    expect(() => splitKeepingRows("abc", 0, { unit: "codepoint" })).toThrow(RangeError);
    expect(() => splitKeepingRows("a👨‍👩‍👧‍👦b", 2, { unit: "codepoint" })).toThrow(RangeError);
  });
});
