import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const root = read("../../package.json");
const { adr, entries } = read("../../docs/security/dependency-allowlist.json");
const DAY = 86_400_000;

test("package.json ignores exactly the allowlisted advisories", () => {
  const ignored = [...root.pnpm.auditConfig.ignoreGhsas].sort();
  expect(ignored).toEqual(entries.map((e) => e.ghsa).sort());
});

test("every entry sunsets within 90 days of being added and has not lapsed", () => {
  for (const e of entries) {
    const span = (Date.parse(e.sunset) - Date.parse(e.added)) / DAY;
    expect(span, e.ghsa).toBeGreaterThan(0);
    expect(span, e.ghsa).toBeLessThanOrEqual(90);
    expect(Date.parse(e.sunset), `${e.ghsa} sunset passed`).toBeGreaterThan(Date.now());
  }
});

test("the ADR the allowlist cites exists and names every entry's package", () => {
  const text = readFileSync(new URL(`../../${adr}`, import.meta.url), "utf8");
  for (const e of entries) {
    expect(text).toContain(e.ghsa);
  }
});
