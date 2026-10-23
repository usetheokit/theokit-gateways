import { afterEach, describe, expect, it, vi } from "vitest";

import { IMessageAdapter } from "../src/index.js";
import { type FakeChild, fakeSpawn, until } from "./fake-child.js";

async function connected(): Promise<{
  adapter: IMessageAdapter;
  child: FakeChild;
  spawned: () => number;
}> {
  const fake = fakeSpawn();
  const adapter = new IMessageAdapter({ spawn: fake.spawn });
  const connecting = adapter.connect();
  await until(() => fake.children.at(-1)?.last("watch.subscribe") !== undefined, "subscribe");
  const child = fake.children.at(-1) as FakeChild;
  child.answer((child.last("watch.subscribe") as { id: number }).id, { subscription: 1 });
  expect(await connecting).toBe(true);
  return { adapter, child, spawned: () => fake.children.length };
}

/** Send one message and answer its `send` request with the given error. */
async function sendAnswered(
  adapter: IMessageAdapter,
  child: FakeChild,
  code: number,
  message: string,
  data?: unknown,
) {
  const sending = adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "hello" });
  await until(() => child.last("send") !== undefined, "send");
  child.fail((child.last("send") as { id: number }).id, code, message, data);
  return sending;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("imsg send errors", () => {
  it("-32001 is an uncertain outcome and is not retried", async () => {
    const { adapter, child } = await connected();

    const result = await sendAnswered(adapter, child, -32001, "send receipt missing");

    expect(result).toEqual({
      ok: false,
      error: { code: "imsg_outcome_uncertain", message: "send receipt missing" },
    });
    expect(child.written.filter((r) => r.method === "send")).toHaveLength(1);
  });

  it("a missing chat is not sent", async () => {
    const { adapter, child } = await connected();

    const result = await sendAnswered(adapter, child, -32602, "chat not found", {
      state: "not_started",
      retry_safe: true,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "imsg_not_sent", message: "chat not found" },
    });
    expect(child.written.filter((r) => r.method === "send")).toHaveLength(1);
  });

  it("-32004 ends the child and reports disconnected", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();

    const result = await sendAnswered(adapter, child, -32004, "send lane blocked");

    expect(result).toEqual({
      ok: false,
      error: { code: "imsg_send_lane_blocked", message: "send lane blocked" },
    });
    await until(() => child.stdinEnded, "the adapter to close imsg's stdin");
    const after = await adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "again" });
    expect(after.ok).toBe(false);
    expect(after.error?.code).toBe("not_connected");
  });

  it("any other error is imsg_error with imsg's message", async () => {
    const { adapter, child } = await connected();

    const result = await sendAnswered(adapter, child, -32603, "AppleScript failed");

    expect(result).toEqual({
      ok: false,
      error: { code: "imsg_error", message: "AppleScript failed" },
    });
  });
});
