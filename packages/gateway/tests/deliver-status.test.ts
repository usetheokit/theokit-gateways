import { describe, expect, it } from "vitest";

import { statusForDeliver } from "../src/webhook/deliver-status.js";

describe("statusForDeliver", () => {
  it("answers 200 for an empty batch and for ok", () => {
    expect(statusForDeliver([])).toBe(200);
    expect(statusForDeliver(["ok", "ok"])).toBe(200);
  });
  it("answers 503 when a handler is missing", () => {
    expect(statusForDeliver(["ok", "no_handler"])).toBe(503);
  });
  it("answers 500 when a handler threw, whatever else happened", () => {
    expect(statusForDeliver(["ok", "handler_threw"])).toBe(500);
    expect(statusForDeliver(["no_handler", "handler_threw", "no_handler"])).toBe(500);
  });
  it("throws for an unknown outcome, naming it", () => {
    expect(() => statusForDeliver(["bogus" as never])).toThrow(/bogus/);
  });
});
