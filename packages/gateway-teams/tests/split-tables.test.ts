import { chunkText } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { splitForTeams } from "../src/split.js";

/**
 * B-556: a table row that fits in a part reaches the platform whole and byte-identical, and text
 * with no table row splits into exactly the chunks `chunkText` gives it without table handling.
 */

const WINDOW = 8000;
const cell = (n: number): string => "x".repeat(n);
/** Rows alternate between a fifth of the window and `fraction` of it, so a long row straddles a cut. */
function table(fraction: number): string {
  const rows = ["| id | note |", "|---|---|"];
  for (let i = 0; i < 8; i += 1) {
    rows.push(`| ${i} | ${cell(Math.floor(WINDOW * (i % 2 === 0 ? 0.2 : fraction)))} |`);
  }
  return `Here is the table.\n\n${rows.join("\n")}\n\nThat is all.`;
}
const rowsOf = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("|"));

describe("splitForTeams table rows", () => {
  it.each([0.3, 0.55, 0.7, 0.9])(
    "keeps every row of a table with %s-window rows whole",
    (fraction) => {
      const text = table(fraction);
      const parts = splitForTeams(text);
      expect(parts.length).toBeGreaterThan(1);
      const delivered = new Set(parts.flatMap((p) => p.split("\n")));
      expect(rowsOf(text).filter((row) => !delivered.has(row))).toEqual([]);
      for (const part of parts) expect(part.length).toBeLessThanOrEqual(WINDOW);
    },
  );

  it("cuts a row longer than the window by length, as before", () => {
    const text = `intro\n| ${cell(WINDOW * 2)} |\nend`;
    expect(splitForTeams(text)).toEqual(
      chunkText(text, {
        limit: 8000,
        boundaries: ["\n\n", "\n", " "],
        lastResort: "last-boundary",
        surrogateGuard: true,
        stripLeading: /^\s+/,
        trimParts: true,
      }),
    );
  });

  it("splits text with no table row into the chunks it split into before", () => {
    const prose = Array.from(
      { length: 400 },
      (_, i) => `Line ${i} has a | pipe mid-line and words.`,
    ).join("\n");
    expect(splitForTeams(prose)).toEqual(
      chunkText(prose, {
        limit: 8000,
        boundaries: ["\n\n", "\n", " "],
        lastResort: "last-boundary",
        surrogateGuard: true,
        stripLeading: /^\s+/,
        trimParts: true,
      }),
    );
    const blocks = prose.replaceAll("\n", "\n\n");
    expect(splitForTeams(blocks)).toEqual(
      chunkText(blocks, {
        limit: 8000,
        boundaries: ["\n\n", "\n", " "],
        lastResort: "last-boundary",
        surrogateGuard: true,
        stripLeading: /^\s+/,
        trimParts: true,
      }),
    );
  });
});
