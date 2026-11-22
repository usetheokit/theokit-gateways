import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A README status line must not pin a version: it goes stale on the first release.
const root = new URL("../../packages/", import.meta.url);
const dirs = readdirSync(root).filter((d) => existsSync(new URL(`${d}/README.md`, root)));

describe("package README status lines", () => {
  it.each(dirs)("%s names no hard-coded package version", (dir) => {
    const lines = readFileSync(new URL(`${dir}/README.md`, root), "utf8").split("\n");
    const bad = lines.filter(
      (l) => /^>?\s*\**Status\b/i.test(l.trim()) && /v?\d+\.\d+\.\d+/.test(l),
    );
    expect(bad).toEqual([]);
  });

  it.each(dirs)("%s labels no scope with a v0.N release tag", (dir) => {
    const text = readFileSync(new URL(`${dir}/README.md`, root), "utf8");
    const bad = text.split("\n").filter((l) => /\bv0\.\d+/.test(l));
    expect(bad).toEqual([]);
  });
});
