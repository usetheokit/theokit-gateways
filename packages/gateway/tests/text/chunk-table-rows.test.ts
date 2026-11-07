import { describe, expect, it } from "vitest";

import { chunkText } from "../../src/index.js";

/** B-556: `keepTableRows` moves a cut that falls inside a table row back to the row's start. */

const options = {
  limit: 100,
  boundaries: ["\n\n", "\n", " "],
  lastResort: "last-boundary",
} as const;
const row = (n: number): string => `| ${"x".repeat(n)} |`;

describe("chunkText keepTableRows", () => {
  const text = ["intro", row(10), row(80), row(10)].join("\n");

  it("cuts through the straddling row by default", () => {
    expect(chunkText(text, options).join("\n")).not.toContain(row(80));
  });

  it("moves the cut to the row's start and keeps the row byte-identical", () => {
    const parts = chunkText(text, { ...options, keepTableRows: true });
    expect(parts).toEqual([`intro\n${row(10)}`, `${row(80)}\n${row(10)}`]);
  });

  it("handles CRLF endings and indented rows", () => {
    const crlf = ["intro", row(10), `  ${row(80)}`, row(10)].join("\r\n");
    const parts = chunkText(crlf, { ...options, keepTableRows: true });
    const delivered = parts.flatMap((p) => p.split("\n").map((l) => l.replace(/\r$/, "")));
    expect(delivered).toContain(`  ${row(80)}`);
  });

  it("cuts a row longer than the window, or one that opens the chunk, by length", () => {
    const long = `intro\n${row(150)}\nend`;
    expect(chunkText(long, { ...options, keepTableRows: true })).toEqual(chunkText(long, options));
    const opening = `${row(150)}\nend`;
    expect(chunkText(opening, { ...options, keepTableRows: true })).toEqual(
      chunkText(opening, options),
    );
  });

  it("leaves text with no table row exactly as without the option", () => {
    const prose = Array.from({ length: 60 }, (_, i) => `Line ${i} has a | pipe in it.`).join("\n");
    expect(chunkText(prose, { ...options, keepTableRows: true })).toEqual(
      chunkText(prose, options),
    );
  });
});
