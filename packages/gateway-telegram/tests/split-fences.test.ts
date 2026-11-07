import { describe, expect, it } from "vitest";

import { splitForTelegram } from "../src/split.js";

/** B-526: a cut inside a fenced block closes the fence and the next chunk reopens it. */

const fenceCount = (t: string): number => t.split("\n").filter((l) => /^```/.test(l)).length;
const codeLines = Array.from({ length: 400 }, (_, i) => `const v${i} = ${i}; // **x`);

describe("splitForTelegram fences", () => {
  it("returns chunks with an even count of fence lines and every code line intact", () => {
    const text = `Intro\n\n\`\`\`ts\n${codeLines.join("\n")}\n\`\`\`\n\nOutro`;
    expect(text.length).toBeGreaterThan(8192);
    const parts = splitForTelegram(text);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4096);
      expect(fenceCount(p) % 2).toBe(0);
    }
    const inner = parts.flatMap((p) => p.split("\n")).filter((l) => l.startsWith("const v"));
    expect(inner).toEqual(codeLines);
    expect(parts[1]?.startsWith("```ts\n")).toBe(true);
    expect(parts.at(-1)).toContain("Outro");
  });

  it("does not count inline markers inside a fence when balancing", () => {
    const text = `\`\`\`\n${codeLines.join("\n")}\n\`\`\``;
    const parts = splitForTelegram(text);
    const inner = parts.flatMap((p) => p.split("\n")).filter((l) => l.startsWith("const v"));
    expect(inner).toEqual(codeLines);
  });
});
