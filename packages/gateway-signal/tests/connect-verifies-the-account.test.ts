import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalAdapter } from "../src/index.js";
import { FakeChild, fakeSpawn, until } from "./fake-child.js";

const ACCOUNT = "+5511999990000";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SignalAdapter.connect", () => {
  it("connect returns false when signal-cli cannot be spawned", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new SignalAdapter({
      account: ACCOUNT,
      spawn: () => {
        const child = new FakeChild();
        queueMicrotask(() => child.emit("error", new Error("spawn signal-cli ENOENT")));
        return child;
      },
    });

    await expect(adapter.connect()).resolves.toBe(false);
  });

  it("connect returns false when the spawn seam throws", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new SignalAdapter({
      account: ACCOUNT,
      spawn: () => {
        throw new Error("EACCES");
      },
    });

    await expect(adapter.connect()).resolves.toBe(false);
  });

  it("spawns signal-cli in JSON-RPC mode for the account", async () => {
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({
      account: ACCOUNT,
      configDir: "/srv/signal",
      spawn: fake.spawn,
    });

    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("listGroups") as { id: number }).id, []);
    await connecting;

    expect(fake.calls).toEqual([
      { command: "signal-cli", args: ["-a", ACCOUNT, "--config", "/srv/signal", "jsonRpc"] },
    ]);
  });

  it("connect returns true only after listGroups answers", async () => {
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn });
    let settled = false;

    const connecting = adapter.connect().then((ok) => {
      settled = true;
      return ok;
    });
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
    expect(settled).toBe(false);
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("listGroups") as { id: number }).id, []);

    await expect(connecting).resolves.toBe(true);
  });

  it("connect returns false when listGroups answers an error", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn });

    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
    const child = fake.children[0] as FakeChild;
    child.fail(
      (child.last("listGroups") as { id: number }).id,
      -1,
      "User +5511999990000 is not registered.",
    );

    await expect(connecting).resolves.toBe(false);
    expect(child.killed).toBe(true);
  });

  it("a second connect does not spawn a second process", async () => {
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn });
    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("listGroups") as { id: number }).id, []);
    await connecting;

    await expect(adapter.connect()).resolves.toBe(true);
    expect(fake.calls).toHaveLength(1);
  });

  it("two concurrent connects start one signal-cli and share its answer", async () => {
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn });

    const both = Promise.all([adapter.connect(), adapter.connect()]);
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("listGroups") as { id: number }).id, []);

    await expect(both).resolves.toEqual([true, true]);
    expect(fake.calls).toHaveLength(1);
  });

  it("connect gives up after 10000 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn });
    let result: boolean | undefined;

    const connecting = adapter.connect().then((ok) => {
      result = ok;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(501);
    await connecting;

    expect(result).toBe(false);
    expect(fake.children[0]?.killed).toBe(true);
  });

  it("disconnect is safe before connect and twice after it", async () => {
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn });
    await expect(adapter.disconnect()).resolves.toBeUndefined();

    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("listGroups") as { id: number }).id, []);
    await connecting;

    await adapter.disconnect();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(child.killed).toBe(true);
  });

  it("refuses an account that is not an E.164 number", () => {
    expect(() => new SignalAdapter({ account: "5511999990000" })).toThrow(/E\.164/);
  });
});
