import { describe, expect, it } from "vitest";

import { splitForTalk, TALK_MAX_LENGTH } from "../src/split.js";

/**
 * B-556 FR-004 to FR-007, FR-009, NFR-001, AC-003: a table row that fits in a part arrives whole
 * in one part. Before this, splitForTalk cut wherever the length ran out, so a table of twice the
 * limit arrived with rows split across two messages. The same fixtures run in gateway-line,
 * gateway-sms and gateway-nextcloud-talk, each of which carries its own copy of the rule (plan D2).
 */

const HEADER = "| id | name | value | note |";
const SEPARATOR = "|---|:---:|---:|---|";
const plainRow = (i: number): string =>
  `| ${i} | item-${i} | ${1000 + i} | plain text cell number ${i} |`;

/** A table of at least `minLength` characters, its length summed as it grows. */
function tableOfLength(minLength: number, row: (i: number) => string = plainRow): string {
  const lines = [HEADER, SEPARATOR];
  let length = HEADER.length + 1 + SEPARATOR.length;
  for (let i = 0; length < minLength; i += 1) {
    const next = row(i);
    lines.push(next);
    length += next.length + 1;
  }
  return lines.join("\n");
}

const wrap = (t: string): string => `Here is the table.\n\n${t}\n\nThat is all.`;
const LINE_BREAK = /\r\n|\r|\n/;
const rowsOf = (t: string): string[] => t.split(LINE_BREAK).filter((l) => /^[^\S\r\n]*\|/.test(l));

/** Each row of `text` that no part holds as a whole line. */
function rowsNotWhole(text: string, parts: readonly string[]): string[] {
  const lines = new Set(parts.flatMap((part) => unprefixed(part).split(LINE_BREAK)));
  return rowsOf(text).filter((row) => !lines.has(row));
}

const LIMIT = TALK_MAX_LENGTH;
const PART_LIMIT = TALK_MAX_LENGTH;
const split = (text: string): string[] => splitForTalk(text);
const splitAt = (text: string, partLimit: number): string[] => splitForTalk(text, partLimit);
const unprefixed = (part: string): string => part;
/** Talk counts code points, not UTF-16 units. */
const measure = (part: string): number => Array.from(part).length;

/** A row of exactly `length` characters. */
const rowOfLength = (length: number): string => `| ${"x".repeat(length - 4)} |`;

/** Every part within the limit, and the parts joined give the input back (NFR-001, FR-009). */
function expectWholeDelivery(text: string, parts: readonly string[]): void {
  for (const part of parts) expect(measure(part)).toBeLessThanOrEqual(LIMIT);
  expect(parts.map(unprefixed).join("")).toBe(text);
}

describe("splitForTalk keeps table rows whole", () => {
  it("keeps every row whole in a table of 2x and 3x the limit", () => {
    for (const factor of [2, 3]) {
      const text = wrap(tableOfLength(factor * LIMIT));
      const parts = split(text);
      expect(rowsNotWhole(text, parts)).toEqual([]);
      expectWholeDelivery(text, parts);
    }
  });

  it("returns a table of exactly the limit as one part, unchanged", () => {
    const head = tableOfLength(LIMIT - 200);
    const text = `${head}\n${rowOfLength(LIMIT - head.length - 1)}`;
    expect(text.length).toBe(LIMIT);
    expect(split(text)).toEqual([text]);
  });

  it("keeps every row whole when one row is 60% of the part limit", () => {
    const wide = rowOfLength(Math.floor(PART_LIMIT * 0.6));
    const text = wrap(tableOfLength(2 * LIMIT, (i) => (i === 5 ? wide : plainRow(i))));
    const parts = split(text);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("keeps rows with no closing pipe whole", () => {
    const text = wrap(tableOfLength(2 * LIMIT, (i) => plainRow(i).replace(/ \|$/, "")));
    const parts = split(text);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("cuts only the row longer than the part limit, by length", () => {
    const long = rowOfLength(Math.floor(PART_LIMIT * 1.2));
    const text = wrap(tableOfLength(3 * LIMIT, (i) => (i === 5 ? long : plainRow(i))));
    const parts = split(text);
    expect(rowsNotWhole(text, parts)).toEqual([long]);
    expectWholeDelivery(text, parts);
  });

  it("keeps rows with blanks before their pipe whole", () => {
    const text = wrap(tableOfLength(2 * LIMIT, (i) => `  ${plainRow(i)}`));
    const parts = split(text);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("cuts a row one unit longer than the part limit at the limit (FR-007)", () => {
    expect(splitAt("ab\n|123456789|\ncd", 10).map(unprefixed)).toEqual(["ab\n|123456", "789|\ncd"]);
  });

  it("delivers two rows of exactly the part limit as row, newline, row", () => {
    const row = rowOfLength(PART_LIMIT);
    const parts = split(`${row}\n${row}`);
    expect(parts.map(unprefixed)).toEqual([row, "\n", row]);
    expectWholeDelivery(`${row}\n${row}`, parts);
  });

  it("cuts two rows of the part limit plus one by length, every part within the limit", () => {
    const row = rowOfLength(PART_LIMIT + 1);
    const text = `${row}\n${row}`;
    expectWholeDelivery(text, split(text));
  });

  it("keeps a CRLF row of exactly the part limit whole when the cut falls inside it", () => {
    expect(splitAt("xx\r\n|12345678|\r\nzz", 10).map(unprefixed)).toEqual([
      "xx\r\n",
      "|12345678|",
      "\r\nzz",
    ]);
  });

  it("reads a lone CR as a line ending, so a row between two of them stays whole", () => {
    expect(splitAt("xxx\r|12345678|\rzzz", 10).map(unprefixed)).toEqual([
      "xxx\r",
      "|12345678|",
      "\rzzz",
    ]);
  });
});

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
