import { describe, expect, it } from "vitest";

import { splitForTelegram } from "../src/split.js";

/**
 * B-556: a table row that fits in a chunk reaches Telegram whole and byte-identical, and text with
 * no table row splits as before.
 */

const WINDOW = 4000;
const cell = (n: number): string => "x".repeat(n);
function table(fraction: number): string {
  const rows = ["| id | note |", "|---|---|"];
  for (let i = 0; i < 8; i += 1) {
    rows.push(`| ${i} | ${cell(Math.floor(WINDOW * (i % 2 === 0 ? 0.2 : fraction)))} |`);
  }
  return `Here is the table.\n\n${rows.join("\n")}\n\nThat is all.`;
}
const rowsOf = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("|"));

/** The splitter before B-556, for text with no marker pair to balance. */
function previousSplit(text: string): string[] {
  if (text.length <= 4096) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= WINDOW) {
      parts.push(remaining);
      break;
    }
    let boundary = remaining.lastIndexOf("\n\n", WINDOW);
    if (boundary < WINDOW / 2) boundary = remaining.lastIndexOf("\n", WINDOW);
    if (boundary < WINDOW / 2) boundary = WINDOW;
    parts.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\n+/, "");
  }
  return parts;
}

describe("splitForTelegram table rows", () => {
  it.each([0.3, 0.55, 0.7, 0.9])(
    "keeps every row of a table with %s-window rows whole",
    (fraction) => {
      const text = table(fraction);
      const parts = splitForTelegram(text);
      expect(parts.length).toBeGreaterThan(1);
      const delivered = new Set(parts.flatMap((p) => p.split("\n")));
      expect(rowsOf(text).filter((row) => !delivered.has(row))).toEqual([]);
      for (const part of parts) expect(part.length).toBeLessThanOrEqual(4096);
    },
  );

  it("cuts a row longer than the window by length, as before", () => {
    const text = `intro\n| ${cell(WINDOW * 2)} |\nend`;
    expect(splitForTelegram(text)).toEqual(previousSplit(text));
  });

  it("splits text with no table row into the chunks it split into before", () => {
    const prose = Array.from({ length: 400 }, (_, i) => `Line ${i} has a | pipe mid-line.`).join(
      "\n",
    );
    expect(splitForTelegram(prose)).toEqual(previousSplit(prose));
    const blocks = prose.replaceAll("\n", "\n\n");
    expect(splitForTelegram(blocks)).toEqual(previousSplit(blocks));
  });
});
