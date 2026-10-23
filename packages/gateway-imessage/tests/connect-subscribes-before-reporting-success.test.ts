import { afterEach, describe, expect, it, vi } from "vitest";

import { IMessageAdapter } from "../src/index.js";
import { FakeChild, fakeSpawn, until } from "./fake-child.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function quietStderr(): void {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("IMessageAdapter.connect", () => {
  it("spawns imsg rpc, with --db when a database path is given", async () => {
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({
      cliPath: "/opt/bin/imsg",
      dbPath: "/Users/bot/Library/Messages/chat.db",
      spawn: fake.spawn,
    });

    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("watch.subscribe") !== undefined, "watch.subscribe");
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("watch.subscribe") as { id: number }).id, { subscription: 1 });
    await connecting;

    expect(fake.calls).toEqual([
      {
        command: "/opt/bin/imsg",
        args: ["rpc", "--db", "/Users/bot/Library/Messages/chat.db"],
      },
    ]);
  });

  it("connect returns true only after watch.subscribe answers", async () => {
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    let settled = false;

    const connecting = adapter.connect().then((ok) => {
      settled = true;
      return ok;
    });
    await until(() => fake.children[0]?.last("watch.subscribe") !== undefined, "watch.subscribe");
    const child = fake.children[0] as FakeChild;
    const subscribe = child.last("watch.subscribe");
    expect(subscribe?.jsonrpc).toBe("2.0");
    expect(subscribe?.params).toEqual({});
    expect(settled).toBe(false);
    child.answer((subscribe as { id: number }).id, { subscription: 1 });

    await expect(connecting).resolves.toBe(true);
    expect(fake.calls[0]?.command).toBe("imsg");
  });

  it("connect returns false when imsg cannot be spawned", async () => {
    quietStderr();
    const adapter = new IMessageAdapter({
      spawn: () => {
        const child = new FakeChild();
        queueMicrotask(() => child.emit("error", new Error("spawn imsg ENOENT")));
        return child;
      },
    });

    await expect(adapter.connect()).resolves.toBe(false);
  });

  it("connect returns false when the spawn seam throws", async () => {
    quietStderr();
    const adapter = new IMessageAdapter({
      spawn: () => {
        throw new Error("EACCES");
      },
    });

    await expect(adapter.connect()).resolves.toBe(false);
  });

  it("connect returns false and ends the child when watch.subscribe answers an error", async () => {
    quietStderr();
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });

    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("watch.subscribe") !== undefined, "watch.subscribe");
    const child = fake.children[0] as FakeChild;
    child.fail((child.last("watch.subscribe") as { id: number }).id, -32603, "no database access");

    await expect(connecting).resolves.toBe(false);
    await until(() => child.stdinEnded, "the adapter to close imsg's stdin");
  });

  it("connect returns false when imsg exits before answering", async () => {
    quietStderr();
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });

    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("watch.subscribe") !== undefined, "watch.subscribe");
    (fake.children[0] as FakeChild).exit(1);

    await expect(connecting).resolves.toBe(false);
  });

  it("connect resolves false within 10500 ms when watch.subscribe never answers", async () => {
    quietStderr();
    vi.useFakeTimers();
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    let result: boolean | undefined;

    const connecting = adapter.connect().then((ok) => {
      result = ok;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(501);
    await connecting;

    expect(result).toBe(false);
    expect(fake.children[0]?.stdinEnded).toBe(true);
  });

  it("a second connect does not spawn a second process", async () => {
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });

    const first = adapter.connect();
    const second = adapter.connect();
    await until(() => fake.children[0]?.last("watch.subscribe") !== undefined, "watch.subscribe");
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("watch.subscribe") as { id: number }).id, { subscription: 1 });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await expect(adapter.connect()).resolves.toBe(true);
    expect(fake.calls).toHaveLength(1);
  });
});
