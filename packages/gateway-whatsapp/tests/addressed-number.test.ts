/**
 * `isForAnotherNumber` — the addressed-number rule (B-437), split out of inbound-rules.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isForAnotherNumber, lastFourDigits } from "../src/addressed-number.js";

let stderrLines: string[] = [];

beforeEach(() => {
  stderrLines = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lastFourDigits", () => {
  it("keeps the last four digits and drops every other character", () => {
    expect(lastFourDigits("+55 (11) 99999-1234")).toBe("1234");
    expect(lastFourDigits("12")).toBe("12");
    expect(lastFourDigits("abc")).toBe("");
  });
});

describe("isForAnotherNumber", () => {
  const OWN = "PNID";

  it("names a foreign phone number id by its last four digits only", () => {
    const dropped = isForAnotherNumber({ phoneNumberId: "109900001111" }, OWN, new Set());

    expect(dropped).toBe(true);
    expect(stderrLines).toEqual([
      '[whatsapp] dropped inbound addressed to a phone number id ending in 1111: this adapter answers for "PNID". Logged once per id ending.\n',
    ]);
  });

  it("cannot write a forged line through a foreign phone number id", () => {
    isForAnotherNumber({ phoneNumberId: "1\n[whatsapp] forged 2222" }, OWN, new Set());

    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).not.toContain("forged");
    expect(stderrLines[0]?.indexOf("\n")).toBe((stderrLines[0]?.length ?? 0) - 1);
  });

  it("keeps one report per four-digit ending however many foreign ids arrive", () => {
    const reported = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) {
      isForAnotherNumber({ phoneNumberId: String(109_900_000_000 + i) }, OWN, reported);
    }

    expect(reported.size).toBe(10_000);
    expect(stderrLines).toHaveLength(10_000);
  });

  it("names a foreign id with no digit and a message naming no id apart", () => {
    const reported = new Set<string>();
    isForAnotherNumber({ phoneNumberId: "OTHER" }, OWN, reported);
    isForAnotherNumber({ phoneNumberId: undefined }, OWN, reported);

    expect(stderrLines.map((line) => line.split(":")[0])).toEqual([
      "[whatsapp] dropped inbound addressed to a phone number id with no digits",
      "[whatsapp] dropped inbound addressed to no phone number id",
    ]);
  });

  it("drops nothing on the adapter's own number or when there is no own number", () => {
    const own = isForAnotherNumber({ phoneNumberId: OWN }, OWN, new Set());
    const noOwn = isForAnotherNumber({ phoneNumberId: "109900001111" }, undefined, new Set());

    expect([own, noOwn]).toEqual([false, false]);
    expect(stderrLines).toEqual([]);
  });
});
