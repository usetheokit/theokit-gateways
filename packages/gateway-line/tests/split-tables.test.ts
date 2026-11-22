import { chunkByGrapheme } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { describeSplitTableRows, graphemeCorpus } from "../../../shared/split-tables-cases.js";
import { splitForLine } from "../src/split.js";

describeSplitTableRows(
  { describe, it, expect },
  {
    name: "splitForLine",
    limit: 5000,
    partLimit: 5000,
    split: (text) => splitForLine(text),
    splitAt: (text, partLimit) => splitForLine(text, partLimit),
    unprefixed: (part) => part,
    measure: (part) => part.length,
  },
);

describe("splitForLine limits and equivalence", () => {
  it("throws the core's RangeError for a limit that is not a positive integer", () => {
    for (const value of [0, 1.5, Number.NaN]) {
      for (const text of ["abc", "x".repeat(6000)]) {
        expect(() => splitForLine(text, value)).toThrow(
          new RangeError(`chunkByGrapheme: limit must be a positive integer, received ${value}`),
        );
      }
    }
  });

  it("cuts text with no table row exactly where chunkByGrapheme cuts it", () => {
    for (const partLimit of [1592, 5000]) {
      for (const text of graphemeCorpus()) {
        expect(splitForLine(text, partLimit)).toEqual(
          chunkByGrapheme(text, { limit: 1, partLimit }),
        );
      }
    }
  });
});
