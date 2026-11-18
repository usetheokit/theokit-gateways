import { describe, expect, it } from "vitest";

import { createStreamMasker } from "../src/stream-mask.js";

function run(chunks: string[], secrets: string[]): string {
  const m = createStreamMasker(secrets);
  return chunks.map((c) => m.push(c)).join("") + m.flush();
}

describe("createStreamMasker", () => {
  it("masks a secret split across chunks and never emits a fragment", () => {
    const m = createStreamMasker(["tok-123"]);
    const first = m.push("key tok-");
    expect(first).not.toContain("tok");
    const out = first + m.push("123 done") + m.flush();
    expect(out).toBe("key [redacted] done");
  });
  it("flushes a held tail that never became a secret", () => {
    expect(run(["abc to"], ["tok-123"])).toBe("abc to");
  });
  it("handles several secrets and ignores empty ones", () => {
    expect(run(["a1", "b2 a", "1"], ["a1", "b2", ""])).toBe("[redacted][redacted] [redacted]");
  });
  it("passes text through with no secrets", () => {
    expect(run(["x", "y"], [])).toBe("xy");
  });
});
