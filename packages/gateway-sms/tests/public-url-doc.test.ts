import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("publicUrl docs", () => {
  it("each publicUrl member documents precedence over forwarded headers", () => {
    const src = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
    const re = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*readonly publicUrl: string;/g;
    const docs = [...src.matchAll(re)].map((m) => (m[1] ?? "").replace(/\s*\*\s*/g, " "));
    expect(docs).toHaveLength(3);
    for (const d of docs) {
      expect(d).toContain("URL the signature is checked against");
      expect(d).toContain("before `x-forwarded-proto`");
      expect(d).toContain("`host` header");
    }
  });
});
