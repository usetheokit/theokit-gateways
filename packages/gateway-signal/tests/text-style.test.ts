import { describe, expect, it } from "vitest";

import { toTextStyle } from "../src/index.js";

describe("toTextStyle", () => {
  it("removes a bold marker and records its range", () => {
    expect(toTextStyle("**Hi** team")).toEqual({ message: "Hi team", textStyle: ["0:2:BOLD"] });
  });

  it("styles bold, italic, strikethrough and code in UTF-16 units", () => {
    // The emoji is one code point and two UTF-16 units. Signal counts ranges in UTF-16 units, so a
    // count by code point would put every range below one place too early.
    const styled = toTextStyle("👋 **a** *b* _c_ ~~d~~ `e`");

    expect(styled.message).toBe("👋 a b c d e");
    expect(styled.textStyle).toEqual([
      "3:1:BOLD",
      "5:1:ITALIC",
      "7:1:ITALIC",
      "9:1:STRIKETHROUGH",
      "11:1:MONOSPACE",
    ]);
  });

  it("keeps markers inside inline code literal", () => {
    expect(toTextStyle("run `a**b**c` now")).toEqual({
      message: "run a**b**c now",
      textStyle: ["4:7:MONOSPACE"],
    });
  });

  it("nests italic inside bold", () => {
    expect(toTextStyle("**a _b_ c**")).toEqual({
      message: "a b c",
      textStyle: ["0:5:BOLD", "2:1:ITALIC"],
    });
  });

  it("leaves an unpaired marker as text", () => {
    expect(toTextStyle("2 * 3 = 6 and **open")).toEqual({
      message: "2 * 3 = 6 and **open",
      textStyle: [],
    });
  });

  it("does not read an underscore inside a word as italic", () => {
    expect(toTextStyle("snake_case_name")).toEqual({ message: "snake_case_name", textStyle: [] });
  });

  it("returns plain text unchanged", () => {
    expect(toTextStyle("nothing to style")).toEqual({ message: "nothing to style", textStyle: [] });
  });
});
