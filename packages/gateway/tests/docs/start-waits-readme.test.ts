import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

class Refusing extends MockAdapter {
  override async connect(): Promise<boolean> {
    return false;
  }
}
class Hanging extends MockAdapter {
  override connect(): Promise<boolean> {
    return new Promise(() => {});
  }
}

describe("README: start() waits for every connect", () => {
  it("rollback still waits after a failure, and the README says so", async () => {
    const runner = new GatewayRunner({
      adapters: [new Refusing(), new Hanging()],
      handler: async () => {},
    });
    let settled = false;
    runner.start().then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    const readme = await readFile(join(__dirname, "../../README.md"), "utf8");
    expect(readme).not.toContain("until the first failure");
    expect(readme.replace(/\s+/g, " ")).toContain("holds after a failure too");
  });
});
