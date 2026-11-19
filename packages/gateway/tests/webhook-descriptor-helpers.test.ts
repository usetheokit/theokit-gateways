import { describe, expect, it } from "vitest";
import { ingestResultForStatus, webhookHeader } from "../src/index.js";

describe("webhookHeader", () => {
  it("finds a header whatever its case", () => {
    expect(webhookHeader({ "X-Signature": "abc" }, "x-signature")).toBe("abc");
  });
  it("is undefined when absent", () => {
    expect(webhookHeader({}, "x-signature")).toBeUndefined();
  });
});

describe("ingestResultForStatus", () => {
  it("maps statuses", () => {
    expect(ingestResultForStatus(400)).toBe("malformed");
    expect(ingestResultForStatus(503)).toBe("no_handler");
    expect(ingestResultForStatus(200)).toBe("delivered");
  });
});
