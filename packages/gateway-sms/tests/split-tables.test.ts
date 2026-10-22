import { chunkByGrapheme } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { splitForSMS } from "../src/split.js";

/**
 * B-556 FR-004 to FR-007, FR-009, NFR-001, AC-003: a table row that fits in a part arrives whole
 * in one part. Before this, splitForSMS cut wherever the length ran out, so a table of twice the
 * limit arrived with rows split across two messages. The same fixtures run in gateway-line,
 * gateway-sms and gateway-nextcloud-talk, each of which carries its own copy of the rule (plan D2).
 */

const HEADER = "| id | name | value | note |";
const SEPARATOR = "|---|:---:|---:|---|";
const plainRow = (i: number): string =>
  `| ${i} | item-${i} | ${1000 + i} | plain text cell number ${i} |`;

/** A table of `rows` rows built by `row`. */
function tableOfRows(rows: number, row: (i: number) => string = plainRow): string {
  const lines = [HEADER, SEPARATOR];
  for (let i = 0; i < rows; i += 1) lines.push(row(i));
  return lines.join("\n");
}

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

const LIMIT = 1600;
/** The payload a part carries beside a "(i/N) " prefix of six characters (fewer than ten parts). */
const PART_LIMIT = 1594;
const split = (text: string): string[] => splitForSMS(text);
const splitAt = (text: string, partLimit: number): string[] => splitForSMS(text, partLimit + 6);
const unprefixed = (part: string): string => part.replace(/^\(\d+\/\d+\) /, "");
const measure = (part: string): number => part.length;

/** A row of exactly `length` characters. */
const rowOfLength = (length: number): string => `| ${"x".repeat(length - 4)} |`;

/** Every part within the limit, and the parts joined give the input back (NFR-001, FR-009). */
function expectWholeDelivery(text: string, parts: readonly string[]): void {
  for (const part of parts) expect(measure(part)).toBeLessThanOrEqual(LIMIT);
  expect(parts.map(unprefixed).join("")).toBe(text);
}

describe("splitForSMS keeps table rows whole", () => {
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

  it("cuts a row longer than the part limit by length and keeps the rows around it whole", () => {
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

  it("keeps rows holding emoji sequences whole and severs no grapheme", () => {
    const text = wrap(tableOfLength(2 * LIMIT, (i) => `| ${i} | 👩‍👩‍👧 family | 🇧🇷 flag ${i} |`));
    const parts = split(text);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
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

/** "a" with 6000 combining acute accents: one grapheme longer than any part limit here. */
const OVERSIZED = `a${"́".repeat(6000)}`;

/** The grapheme test corpus of the core, plus the oversized grapheme at a part's start, middle and end. */
function graphemeCorpus(): string[] {
  const texts = ["", "short", "🇯🇵🇯🇵 regional indicators", "a̐éö̲ combining"];
  const word = "the quick brown fox 🦊 ";
  for (const size of [1592, 1593, 1599, 1600, 1601, 3200, 4999, 5000, 5001, 12000]) {
    texts.push(word.repeat(Math.ceil(size / word.length)).slice(0, size), "x".repeat(size));
  }
  texts.push(`${"x".repeat(1591)}😀${"y".repeat(50)}`);
  texts.push(`${OVERSIZED}${"x".repeat(3000)}`);
  texts.push(`${"x".repeat(800)}${OVERSIZED}${"x".repeat(3000)}`);
  texts.push(`${"x".repeat(3000)}${OVERSIZED}`);
  return texts;
}

const prefixWidthFor = (total: number): number => 2 * String(total).length + 4;
const labelOf = (part: string): string => /^\(\d+\/\d+\)/.exec(part)?.[0] ?? "";

/** `splitForSMS` as it was at 688c322: `chunkByGrapheme` inside the prefix fixed point. */
function splitAt688c322(text: string, limit = 1600): string[] {
  let reserved = prefixWidthFor(1);
  for (let pass = 0; pass < 8; pass += 1) {
    const parts = chunkByGrapheme(text, { limit, partLimit: limit - reserved });
    if (parts.length <= 1) return parts;
    const needed = prefixWidthFor(parts.length);
    if (needed <= reserved) return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
    reserved = needed;
  }
  throw new RangeError("splitAt688c322: the prefix width did not settle");
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
    expect(splitAt688c322(text)).toHaveLength(3);
    const parts = splitForSMS(text);
    expect(parts.map(labelOf)).toEqual(["(1/4)", "(2/4)", "(3/4)", "(4/4)"]);
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("labels every part (i/10) when the row rule takes nine parts to ten", () => {
    const text = tableOfRows(263);
    expect(splitAt688c322(text)).toHaveLength(9);
    const parts = splitForSMS(text);
    expect(parts.map(labelOf)).toEqual(Array.from({ length: 10 }, (_, i) => `(${i + 1}/10)`));
    expect(rowsNotWhole(text, parts)).toEqual([]);
    expectWholeDelivery(text, parts);
  });

  it("keeps a last rest of 1593 to 1600 units within 1600 with its prefix", () => {
    for (const rest of [1593, 1597, 1600])
      expectWholeDelivery("x".repeat(1594 + rest), split("x".repeat(1594 + rest)));
  });

  it("throws the core's RangeError for a NaN limit and the too-small error for a tiny one", () => {
    expect(() => splitForSMS("x".repeat(2000), Number.NaN)).toThrow(
      new RangeError("chunkByGrapheme: limit must be a positive integer, received NaN"),
    );
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
