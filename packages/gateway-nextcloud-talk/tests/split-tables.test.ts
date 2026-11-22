import { describe, expect, it } from "vitest";

import { describeSplitTableRows, tableOfLength, wrap } from "../../../shared/split-tables-cases.js";
import { splitForTalk, TALK_MAX_LENGTH } from "../src/split.js";

const LIMIT = TALK_MAX_LENGTH;
const split = (text: string): string[] => splitForTalk(text);
const { expectWholeDelivery, rowsNotWhole } = describeSplitTableRows(
  { describe, it, expect },
  {
    name: "splitForTalk",
    limit: LIMIT,
    partLimit: LIMIT,
    split,
    splitAt: (text, partLimit) => splitForTalk(text, partLimit),
    unprefixed: (part) => part,
    // Talk counts code points, not UTF-16 units.
    measure: (part) => Array.from(part).length,
  },
);

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const astralRow = (i: number): string => `| ${i} | 😀😀😀 | 𝒜𝒷𝒸 | cell ${i} |`;

describe("splitForTalk counts rows in code points", () => {
  it("keeps rows of astral characters whole", () => {
    const text = wrap(tableOfLength(3 * LIMIT, astralRow));
    const parts = split(text);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("splits no surrogate pair in a table of astral characters", () => {
    const parts = split(wrap(tableOfLength(3 * LIMIT, astralRow)));
    for (const part of parts) expect(LONE_SURROGATE.test(part)).toBe(false);
  });

  it("gives no part for an empty text", () => {
    expect(splitForTalk("")).toEqual([]);
  });

  it("keeps a row of 20000 astral characters whole inside a table over 32000 code points", () => {
    const wide = `| ${"😀".repeat(20_000)} |`;
    const text = `${tableOfLength(20_000)}\n${wide}\n${tableOfLength(20_000)}`;
    const parts = split(text);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });
});

describe("splitForTalk core delegation", () => {
  it("cuts before a ZWJ family emoji that straddles the limit", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const text = `${"a".repeat(31_999)}${family}`;
    const parts = splitForTalk(text, TALK_MAX_LENGTH);
    expect(parts).toEqual(["a".repeat(31_999), family]);
    for (const part of parts) expect(Array.from(part).length).toBeLessThanOrEqual(32_000);
  });

  it("throws a RangeError naming limit for a limit of 0", () => {
    expect(() => splitForTalk("x", 0)).toThrow(RangeError);
    expect(() => splitForTalk("x", 0)).toThrow(/limit/);
  });
});
