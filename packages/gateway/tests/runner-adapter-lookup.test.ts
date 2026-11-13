/** `GatewayRunner.adapter()`, `connected` and `maskSecrets`. */
import { describe, expect, it } from "vitest";

import { GatewayRunner } from "../src/runner/gateway-runner.js";
import { maskSecrets } from "../src/security/credential-patterns.js";
import { MockAdapter } from "./adapter/mock-adapter.js";

describe("GatewayRunner.adapter", () => {
  it("returns the registered adapter, connected or not, and undefined otherwise", async () => {
    const slack = new MockAdapter("slack");
    const runner = new GatewayRunner({ adapters: [slack], handler: async () => {} });
    expect(runner.adapter("slack")).toBe(slack);
    expect(runner.adapter("irc" as never)).toBeUndefined();
    expect(runner.connected.size).toBe(0);
    await runner.start();
    expect([...runner.connected]).toEqual(["slack"]);
    await runner.stop();
    expect(runner.connected.size).toBe(0);
    expect(runner.adapter("slack")).toBe(slack);
  });
});

describe("maskSecrets", () => {
  it("masks the longest value first so a containing value goes whole", () => {
    expect(maskSecrets("t=abc-secret-xyz", ["abc", "abc-secret-xyz"])).toBe("t=[redacted]");
  });
  it("ignores empty values and regex characters", () => {
    expect(maskSecrets("a.b a+b", ["", "a+b"])).toBe("a.b [redacted]");
  });
});
