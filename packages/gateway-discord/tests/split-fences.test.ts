import { chunkText } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { splitForDiscord } from "../src/split.js";

/**
 * B-526: a fenced block longer than the platform limit comes out in chunks that each hold an even
 * count of fence lines, with every code line byte-identical.
 *
 * Core `chunkText` only keeps a fence balanced from the release that ships B-518, which is not on
 * npm yet (latest is 0.12.0). Until the peer floor names that release the suite probes the
 * installed core and skips when it does not balance fences; once the floor is raised the probe
 * passes and the cases run.
 */

const LIMIT = 2000;
const codeLines = Array.from(
  { length: Math.ceil((LIMIT * 2.2) / 22) },
  (_, i) => `code_line_${String(i).padStart(5, "0")};`,
);
const text = `Intro\n\n\`\`\`ts\n${codeLines.join("\n")}\n\`\`\`\n\nOutro`;

const fenceLines = (part: string): number =>
  part.split("\n").filter((l) => /^\s*(\(\d+\/\d+\) )?```/.test(l)).length;

const coreBalances = ((): boolean => {
  const parts = chunkText(text, { limit: LIMIT, safeLimit: LIMIT - 100 });
  return parts.length > 1 && parts.every((p) => fenceLines(p) % 2 === 0);
})();

describe("splitForDiscord fences", () => {
  it.skipIf(!coreBalances)(
    "returns chunks with an even count of fence lines and every code line intact",
    () => {
      expect(text.length).toBeGreaterThan(LIMIT * 2);
      const parts = splitForDiscord(text);
      expect(parts.length).toBeGreaterThan(2);
      for (const part of parts) expect(fenceLines(part) % 2).toBe(0);
      const seen = parts.flatMap((p) => p.split("\n")).filter((l) => l.includes("code_line_"));
      expect(seen.map((l) => l.slice(l.indexOf("code_line_")))).toEqual(codeLines);
    },
  );
});
