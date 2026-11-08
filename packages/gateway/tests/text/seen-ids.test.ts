import { describe, expect, it } from "vitest";
import { SeenIds } from "../../src/text/seen-ids.js";

describe("SeenIds", () => {
  it("reports whether an id was new", () => {
    const ids = new SeenIds();
    expect(ids.add("a")).toBe(true);
    expect(ids.add("a")).toBe(false);
    expect(ids.has("a")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("forgets the oldest id past the limit", () => {
    const ids = new SeenIds(2);
    ids.add("a");
    ids.add("b");
    ids.add("c");
    expect(ids.has("a")).toBe(false);
    expect(ids.has("c")).toBe(true);
    expect(ids.size).toBe(2);
  });
});
