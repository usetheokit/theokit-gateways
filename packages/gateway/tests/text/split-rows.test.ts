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
