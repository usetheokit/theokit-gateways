/** SlackAdapter.react — `reactions.add` with a Slack reaction name; `@slack/bolt` is mocked. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const addMock = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true }));

vi.mock("@slack/bolt", () => {
  class MockApp {
    public client = {
      auth: { test: async () => ({ user_id: "UBOT1234" }) },
      chat: { postMessage: async () => ({ ts: "1.2" }) },
      reactions: { add: addMock },
    };
    event = vi.fn();
    start = async () => undefined;
    stop = async () => undefined;
  }
  return { default: { App: MockApp }, App: MockApp };
});

import { SlackAdapter } from "../src/adapter.js";

const fresh = () => new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });

beforeEach(() => addMock.mockClear());

describe("SlackAdapter.react", () => {
  it("maps a unicode emoji to its Slack name", async () => {
    const adapter = fresh();
    await adapter.connect();
    expect(await adapter.react("C1", "1.2", "👀")).toEqual({ ok: true, messageId: "1.2" });
    expect(addMock).toHaveBeenCalledWith({ channel: "C1", timestamp: "1.2", name: "eyes" });
  });

  it("maps ❤️ with or without the variation selector", async () => {
    const adapter = fresh();
    await adapter.connect();
    await adapter.react("C1", "1.2", "❤️");
    await adapter.react("C1", "1.2", "❤");
    expect(addMock.mock.calls.map((c) => c[0]?.name)).toEqual(["heart", "heart"]);
  });

  it("strips colons from a Slack name", async () => {
    const adapter = fresh();
    await adapter.connect();
    await adapter.react("C1", "1.2", ":eyes:");
    expect(addMock.mock.calls[0]?.[0]?.name).toBe("eyes");
  });

  it("answers not_connected before connect, with no request", async () => {
    const r = await fresh().react("C1", "1.2", "👀");
    expect(r.error?.code).toBe("not_connected");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("refuses an empty message id", async () => {
    const adapter = fresh();
    await adapter.connect();
    expect((await adapter.react("C1", "", "👀")).error?.code).toBe("invalid_reaction");
  });
});
