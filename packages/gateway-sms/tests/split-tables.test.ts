import { chunkByGrapheme } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import {
  describeSplitTableRows,
  graphemeCorpus,
  tableOfRows,
} from "../../../shared/split-tables-cases.js";
import { splitForSMS } from "../src/split.js";

const unprefixed = (part: string): string => part.replace(/^\(\d+\/\d+\) /, "");

/** The payload a part carries beside a "(i/N) " prefix of six characters (fewer than ten parts). */
const { expectWholeDelivery, rowsNotWhole } = describeSplitTableRows(
  { describe, it, expect },
  {
    name: "splitForSMS",
    limit: 1600,
    partLimit: 1594,
    split: (text) => splitForSMS(text),
    splitAt: (text, partLimit) => splitForSMS(text, partLimit + 6),
    unprefixed,
    measure: (part) => part.length,
  },
);
const split = (text: string): string[] => splitForSMS(text);

const prefixWidthFor = (total: number): number => 2 * String(total).length + 4;
const labelOf = (part: string): string => /^\(\d+\/\d+\)/.exec(part)?.[0] ?? "";

/** `splitForSMS` as it was at 688c322: `chunkByGrapheme` inside the prefix fixed point. */
function splitWithoutRowRule(text: string, limit = 1600): string[] {
  let reserved = prefixWidthFor(1);
  for (let pass = 0; pass < 8; pass += 1) {
    const parts = chunkByGrapheme(text, { limit, partLimit: limit - reserved });
    if (parts.length <= 1) return parts;
    const needed = prefixWidthFor(parts.length);
    if (needed <= reserved) return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
    reserved = needed;
  }
  throw new RangeError("splitWithoutRowRule: the prefix width did not settle");
}

/** The SMS limit whose settled prefix leaves exactly `partLimit` for the text, and its parts. */
function smsAtPartLimit(text: string, partLimit: number): { limit: number; parts: string[] } {
  for (const width of [6, 8, 10]) {
    const parts = splitForSMS(text, partLimit + width);
    if (parts.length <= 1 || prefixWidthFor(parts.length) === width) {
      return { limit: partLimit + width, parts: parts.map(unprefixed) };
    }
  }
  throw new RangeError(`no prefix width settles at part limit ${partLimit}`);
}

describe("splitForSMS numbering, limits and equivalence", () => {
  it("numbers the parts (1/N) to (N/N) when the row rule adds a part", () => {
    const text = tableOfRows(91);
    expect(splitWithoutRowRule(text)).toHaveLength(3);
    const parts = splitForSMS(text);
    expect(parts.map(labelOf)).toEqual(["(1/4)", "(2/4)", "(3/4)", "(4/4)"]);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("labels every part (i/10) when the row rule takes nine parts to ten", () => {
    const text = tableOfRows(263);
    expect(splitWithoutRowRule(text)).toHaveLength(9);
    const parts = splitForSMS(text);
    expect(parts.map(labelOf)).toEqual(Array.from({ length: 10 }, (_, i) => `(${i + 1}/10)`));
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("keeps a last rest of 1593 to 1600 units within 1600 with its prefix", () => {
    for (const rest of [1593, 1597, 1600])
      expectWholeDelivery("x".repeat(1594 + rest), split("x".repeat(1594 + rest)));
  });

  it("throws the core's RangeError for a NaN limit", () => {
    expect(() => splitForSMS("x".repeat(2000), Number.NaN)).toThrow(
      new RangeError("chunkByGrapheme: limit must be a positive integer, received NaN"),
    );
  });

  it("throws the too-small RangeError for a limit the prefix alone fills", () => {
    expect(() => splitForSMS("x".repeat(100), 4)).toThrow(/is too small to carry an SMS part/);
  });

  it("cuts text with no table row exactly where chunkByGrapheme cuts it", () => {
    for (const partLimit of [1592, 5000]) {
      for (const text of graphemeCorpus()) {
        const { limit, parts } = smsAtPartLimit(text, partLimit);
        expect(parts).toEqual(chunkByGrapheme(text, { limit, partLimit }));
      }
    }
  });
});
