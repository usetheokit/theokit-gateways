/**
 * B-556 FR-004 to FR-007, FR-009, NFR-001, AC-003: a table row that fits in a part arrives whole
 * in one part. The cases every splitter of gateway-sms, gateway-line and gateway-nextcloud-talk
 * owes, and the fixtures they share. A package's test file passes its own vitest and splitter in,
 * because this file sits outside every package and resolves neither.
 */

export interface SplitTableTools {
  readonly describe: (name: string, body: () => void) => void;
  readonly it: (name: string, body: () => unknown) => void;
  // biome-ignore lint/suspicious/noExplicitAny: vitest's `expect` is passed through untouched.
  readonly expect: (value: unknown) => any;
}

export interface SplitTableSpec {
  /** The splitter's name, as the describe title carries it. */
  readonly name: string;
  /** The limit of a whole part, prefix included. */
  readonly limit: number;
  /** The payload a part carries beside its prefix. */
  readonly partLimit: number;
  readonly split: (text: string) => string[];
  /** Split with the given payload per part. */
  readonly splitAt: (text: string, partLimit: number) => string[];
  /** A part without its numbering prefix. */
  readonly unprefixed: (part: string) => string;
  /** The length of a part in the unit the platform counts. */
  readonly measure: (part: string) => number;
}

const HEADER = "| id | name | value | note |";
const SEPARATOR = "|---|:---:|---:|---|";
export const plainRow = (i: number): string =>
  `| ${i} | item-${i} | ${1000 + i} | plain text cell number ${i} |`;

/** A table of `rows` rows built by `row`. */
export function tableOfRows(rows: number, row: (i: number) => string = plainRow): string {
  const lines = [HEADER, SEPARATOR];
  for (let i = 0; i < rows; i += 1) lines.push(row(i));
  return lines.join("\n");
}

/** A table of at least `minLength` characters, its length summed as it grows. */
export function tableOfLength(minLength: number, row: (i: number) => string = plainRow): string {
  const lines = [HEADER, SEPARATOR];
  let length = HEADER.length + 1 + SEPARATOR.length;
  for (let i = 0; length < minLength; i += 1) {
    const next = row(i);
    lines.push(next);
    length += next.length + 1;
  }
  return lines.join("\n");
}

export const wrap = (t: string): string => `Here is the table.\n\n${t}\n\nThat is all.`;
export const LINE_BREAK = /\r\n|\r|\n/;
const rowsOf = (t: string): string[] => t.split(LINE_BREAK).filter((l) => /^[^\S\r\n]*\|/.test(l));

/** Each row of `text` that no part holds as a whole line. */
export function rowsNotWhole(
  text: string,
  parts: readonly string[],
  unprefixed: (part: string) => string,
): string[] {
  const lines = new Set(parts.flatMap((part) => unprefixed(part).split(LINE_BREAK)));
  return rowsOf(text).filter((row) => !lines.has(row));
}

/** "a" with 6000 combining acute accents: one grapheme longer than any part limit here. */
export const OVERSIZED = `a${"́".repeat(6000)}`;

/** The grapheme test corpus of the core, plus the oversized grapheme at a part's start, middle and end. */
export function graphemeCorpus(): string[] {
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

const rowOfLength = (length: number): string => `| ${"x".repeat(length - 4)} |`;

/** Registers the table-row cases of one splitter; returns the helpers its own cases use. */
export function describeSplitTableRows(tools: SplitTableTools, spec: SplitTableSpec) {
  const { describe, it, expect } = tools;
  const { limit: LIMIT, partLimit: PART_LIMIT, split, splitAt, unprefixed, measure } = spec;

  /** Every part within the limit, and the parts joined give the input back (NFR-001, FR-009). */
  function expectWholeDelivery(text: string, parts: readonly string[]): void {
    for (const part of parts) expect(measure(part)).toBeLessThanOrEqual(LIMIT);
    expect(parts.map(unprefixed).join("")).toBe(text);
  }
  const notWhole = (text: string, parts: readonly string[]): string[] =>
    rowsNotWhole(text, parts, unprefixed);

  describe(`${spec.name} keeps table rows whole`, () => {
    it("keeps every row whole in a table of 2x and 3x the limit", () => {
      for (const factor of [2, 3]) {
        const text = wrap(tableOfLength(factor * LIMIT));
        const parts = split(text);
        expect(notWhole(text, parts)).toEqual([]);
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
      expect(notWhole(text, parts)).toEqual([]);
      expectWholeDelivery(text, parts);
    });

    it("keeps rows with no closing pipe whole", () => {
      const text = wrap(tableOfLength(2 * LIMIT, (i) => plainRow(i).replace(/ \|$/, "")));
      const parts = split(text);
      expect(notWhole(text, parts)).toEqual([]);
      expectWholeDelivery(text, parts);
    });

    it("cuts only the row longer than the part limit, by length", () => {
      const long = rowOfLength(Math.floor(PART_LIMIT * 1.2));
      const text = wrap(tableOfLength(3 * LIMIT, (i) => (i === 5 ? long : plainRow(i))));
      const parts = split(text);
      expect(notWhole(text, parts)).toEqual([long]);
      expectWholeDelivery(text, parts);
    });

    it("keeps rows with blanks before their pipe whole", () => {
      const text = wrap(tableOfLength(2 * LIMIT, (i) => `  ${plainRow(i)}`));
      const parts = split(text);
      expect(notWhole(text, parts)).toEqual([]);
      expectWholeDelivery(text, parts);
    });

    it("keeps rows holding emoji sequences whole", () => {
      const text = wrap(tableOfLength(2 * LIMIT, (i) => `| ${i} | 👩‍👩‍👧 family | 🇧🇷 flag ${i} |`));
      const parts = split(text);
      expect(notWhole(text, parts)).toEqual([]);
      expectWholeDelivery(text, parts);
    });

    it("severs no grapheme in a table of emoji sequences", () => {
      const text = wrap(tableOfLength(2 * LIMIT, (i) => `| ${i} | 👩‍👩‍👧 family | 🇧🇷 flag ${i} |`));
      const graphemes = new Set(
        Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
          (s) => s.segment,
        ),
      );
      for (const part of split(text)) {
        for (const { segment } of new Intl.Segmenter(undefined, {
          granularity: "grapheme",
        }).segment(unprefixed(part))) {
          expect(graphemes.has(segment)).toBe(true);
        }
      }
    });

    it("cuts a row one unit longer than the part limit at the limit (FR-007)", () => {
      expect(splitAt("ab\n|123456789|\ncd", 10).map(unprefixed)).toEqual([
        "ab\n|123456",
        "789|\ncd",
      ]);
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

  return { expectWholeDelivery, rowsNotWhole: notWhole };
}
