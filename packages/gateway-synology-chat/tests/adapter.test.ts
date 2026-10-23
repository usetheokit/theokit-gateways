import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SynologyChatAdapter } from "../src/adapter.js";
import { SynologyChatConfigError } from "../src/types.js";
import { BOT_TOKEN, callbackForm, INCOMING_URL, ScriptedNas } from "./fixtures.js";

const FORM = "application/x-www-form-urlencoded";

function makeAdapter(nas: ScriptedNas): SynologyChatAdapter {
  // An injected app keeps connect() from opening a port; these tests call handleCallback directly.
  return new SynologyChatAdapter({
    botToken: BOT_TOKEN,
    incomingUrl: INCOMING_URL,
    app: { post: () => undefined } as never,
    fetch: nas.fetch,
  });
}

async function connected(
  nas = new ScriptedNas(),
): Promise<{ adapter: SynologyChatAdapter; nas: ScriptedNas; seen: MessageEvent[] }> {
  const adapter = makeAdapter(nas);
  const seen: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    seen.push(event);
  });
  expect(await adapter.connect()).toBe(true);
  return { adapter, nas, seen };
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function quiet(): string[] {
  const written: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  return written;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SynologyChatAdapter construction", () => {
  it("throws SynologyChatConfigError for an empty botToken (EC-3)", () => {
    expect(
      () =>
        new SynologyChatAdapter({
          botToken: "",
          incomingUrl: INCOMING_URL,
          fetch: new ScriptedNas().fetch,
        }),
    ).toThrow(SynologyChatConfigError);
  });
});

describe("SynologyChatAdapter.connect", () => {
  it("returns false when user_list does not answer success true", async () => {
    quiet();
    const nas = new ScriptedNas();
    nas.userList = async () => Response.json({ success: false, error: { code: 105 } });

    await expect(makeAdapter(nas).connect()).resolves.toBe(false);
  });

  it("resolves false within 10000 ms when user_list never answers", async () => {
    vi.useFakeTimers();
    quiet();
    const nas = new ScriptedNas();
    nas.userList = () => new Promise(() => undefined);
    let answer: boolean | undefined;
    void makeAdapter(nas)
      .connect()
      .then((ok) => {
        answer = ok;
      });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(answer).toBe(false);
  });

  it("answers false when disconnect() lands while user_list is pending", async () => {
    const nas = new ScriptedNas();
    let answerList: (response: Response) => void = () => undefined;
    nas.userList = () =>
      new Promise((resolve) => {
        answerList = resolve;
      });
    const adapter = makeAdapter(nas);
    const connecting = adapter.connect();
    await adapter.disconnect();
    answerList(Response.json({ success: true }));

    await expect(connecting).resolves.toBe(false);
  });
});

describe("SynologyChatAdapter.handleCallback", () => {
  it("turns a callback from user_id 42 into one event whose channel is 42", async () => {
    const { adapter, seen } = await connected();
    const answer = await adapter.handleCallback(FORM, callbackForm({}));
    await drain();

    expect(answer.status).toBe(200);
    expect(seen).toHaveLength(1);
    const event = seen[0];
    if (event?.platform !== "synology_chat") throw new Error("unreachable");
    expect(event.channel).toEqual({ id: "42", type: "dm" });
    expect(event.synology_chat).toMatchObject({ userId: 42, username: "alice", postId: "1001" });
    expect(event.text).toBe("hello bot");
  });

  it("delivers a callback repeated with the same post_id once, answering both 200", async () => {
    const { adapter, seen } = await connected();
    const first = await adapter.handleCallback(FORM, callbackForm({ post_id: "7" }));
    const second = await adapter.handleCallback(FORM, callbackForm({ post_id: "7" }));
    await drain();

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(seen).toHaveLength(1);
  });

  it("delivers two callbacks with no post_id both (EC-10)", async () => {
    const { adapter, seen } = await connected();
    const noPost = (text: string): string => {
      const form = new URLSearchParams(callbackForm({ text }));
      form.delete("post_id");
      return form.toString();
    };
    await adapter.handleCallback(FORM, noPost("one"));
    await adapter.handleCallback(FORM, noPost("two"));
    await drain();

    expect(seen.map((event) => event.text)).toEqual(["one", "two"]);
  });

  it("answers 400 to an empty token without comparing (EC-3)", async () => {
    const { adapter, seen } = await connected();

    expect((await adapter.handleCallback(FORM, callbackForm({ token: "" }))).status).toBe(400);
    await drain();
    expect(seen).toEqual([]);
  });

  it("answers 400 to a missing user_id or text", async () => {
    const { adapter } = await connected();
    const without = (field: string): string => {
      const form = new URLSearchParams(callbackForm({}));
      form.delete(field);
      return form.toString();
    };

    expect((await adapter.handleCallback(FORM, without("user_id"))).status).toBe(400);
    expect((await adapter.handleCallback(FORM, without("text"))).status).toBe(400);
  });

  it("answers 400 to user_id 42abc, checked as digits rather than parsed (EC-9)", async () => {
    const { adapter, seen } = await connected();

    expect((await adapter.handleCallback(FORM, callbackForm({ user_id: "42abc" }))).status).toBe(
      400,
    );
    expect(seen).toEqual([]);
  });

  it("answers 400 to a JSON body that does not parse", async () => {
    const { adapter } = await connected();

    expect((await adapter.handleCallback("application/json", "{token:")).status).toBe(400);
  });

  it("dates an event with no numeric timestamp at its receipt, never NaN", async () => {
    const { adapter, seen } = await connected();
    await adapter.handleCallback(FORM, callbackForm({ timestamp: "soon", post_id: "" }));
    await drain();

    const event = seen[0];
    if (event?.platform !== "synology_chat") throw new Error("unreachable");
    expect(Number.isFinite(event.synology_chat.timestamp)).toBe(true);
    expect(event.id).not.toContain("NaN");
  });

  it("answers 503 after disconnect() on a route that stays mounted on an injected app", async () => {
    const { adapter } = await connected();
    await adapter.disconnect();

    expect((await adapter.handleCallback(FORM, callbackForm({}))).status).toBe(503);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const adapter = makeAdapter(new ScriptedNas());
    await adapter.connect();

    expect((await adapter.handleCallback(FORM, callbackForm({}))).status).toBe(503);
  });

  it("logs a throwing handler as handler threw and still answers 200", async () => {
    const written = quiet();
    const adapter = makeAdapter(new ScriptedNas());
    adapter.onInbound(async () => {
      throw new Error("user code failed");
    });
    await adapter.connect();
    const answer = await adapter.handleCallback(FORM, callbackForm({}));
    await drain();

    expect(answer.status).toBe(200);
    expect(written.join("")).toContain("handler threw");
  });
});

describe("SynologyChatAdapter.sendMessage", () => {
  it("returns empty_text before checking the connection", async () => {
    const result = await makeAdapter(new ScriptedNas()).sendMessage({
      channel: { id: "42", type: "dm" },
      text: "",
    });

    expect(result.error?.code).toBe("empty_text");
  });

  it("replies to user_id 42 with user_ids exactly [42], markers dropped", async () => {
    const { adapter, nas } = await connected();
    const result = await adapter.sendMessage({
      channel: { id: "42", type: "dm" },
      text: "**hi**",
      format: "markdown",
    });

    expect(result.ok).toBe(true);
    expect(nas.posts()).toEqual([{ text: "hi", user_ids: [42] }]);
  });

  it("refuses a channel id that is not a number before posting, never user_ids [null] (EC-11)", async () => {
    const { adapter, nas } = await connected();
    const result = await adapter.sendMessage({ channel: { id: "alice", type: "dm" }, text: "x" });

    expect(result.error?.code).toBe("invalid_channel");
    expect(nas.posts()).toEqual([]);
  });

  it("turns a refused post into synology_api_error", async () => {
    const nas = new ScriptedNas();
    const { adapter } = await connected(nas);
    nas.chatbot = async () => Response.json({ success: false, error: { code: 120 } });
    const result = await adapter.sendMessage({ channel: { id: "42", type: "dm" }, text: "x" });

    expect(result).toEqual({
      ok: false,
      error: { code: "synology_api_error", message: "chatbot answered error code 120" },
    });
  });

  it("settles timeout after 30000 ms when the incoming URL never answers", async () => {
    vi.useFakeTimers();
    const nas = new ScriptedNas();
    const { adapter } = await connected(nas);
    nas.chatbot = () => new Promise(() => undefined);
    let result: unknown;
    void adapter.sendMessage({ channel: { id: "42", type: "dm" }, text: "x" }).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
  });

  it("writes the incoming URL's token in no error and no stderr line (EC-12)", async () => {
    const written = quiet();
    const nas = new ScriptedNas();
    nas.userList = async () => {
      throw new TypeError(`connect ECONNREFUSED ${INCOMING_URL}`);
    };
    const adapter = makeAdapter(nas);
    await adapter.connect();
    const result = await adapter.sendMessage({ channel: { id: "42", type: "dm" }, text: "x" });

    expect(written.join("")).not.toContain("incoming-secret-xyz");
    expect(JSON.stringify(result)).not.toContain("incoming-secret-xyz");
  });
});
