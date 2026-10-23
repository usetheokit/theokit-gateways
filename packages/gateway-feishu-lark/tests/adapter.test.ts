import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeishuLarkAdapter } from "../src/adapter.js";
import { createLarkTransport, type LarkSdk } from "../src/transport.js";
import type { LarkApiResult, LarkConnectionHandlers, LarkTransport } from "../src/types.js";
import { larkEvent } from "./fixtures.js";

const APP_ID = "cli_0123456789abcdef";

/** A transport that answers what the test sets and records every call. */
class FakeTransport implements LarkTransport {
  token: () => Promise<LarkApiResult> = async () => ({ code: 0 });
  send: () => Promise<LarkApiResult> = async () => ({ code: 0, messageId: "om_sent" });
  readonly created: Array<{ chatId: string; text: string }> = [];
  readonly replied: Array<{ messageId: string; text: string }> = [];
  handlers: LarkConnectionHandlers | undefined;
  closed = 0;

  tenantToken(): Promise<LarkApiResult> {
    return this.token();
  }

  async start(handlers: LarkConnectionHandlers): Promise<void> {
    this.handlers = handlers;
  }

  createMessage(chatId: string, text: string): Promise<LarkApiResult> {
    this.created.push({ chatId, text });
    return this.send();
  }

  replyMessage(messageId: string, text: string): Promise<LarkApiResult> {
    this.replied.push({ messageId, text });
    return this.send();
  }

  close(): void {
    this.closed += 1;
  }

  /** The SDK's dispatcher hands over one event. */
  dispatch(data: unknown): void {
    this.handlers?.onMessage(data);
  }
}

function makeAdapter(transport: FakeTransport): FeishuLarkAdapter {
  return new FeishuLarkAdapter({ appId: APP_ID, appSecret: "secret", transport });
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
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

/** A fake SDK module that records what the transport builds. */
function fakeSdk(): { sdk: LarkSdk; clients: unknown[]; sockets: unknown[] } {
  const clients: unknown[] = [];
  const sockets: unknown[] = [];
  class Client {
    readonly auth = {
      tenantAccessToken: { internal: async () => ({ code: 0, msg: "ok" }) },
    };
    readonly im = {
      message: {
        create: async () => ({ code: 0, data: { message_id: "om_x" } }),
        reply: async () => ({ code: 0, data: { message_id: "om_y" } }),
      },
    };
    constructor(params: unknown) {
      clients.push(params);
    }
  }
  class WSClient {
    constructor(private readonly params: { onReady?: () => void }) {
      sockets.push(params);
    }
    async start(): Promise<void> {
      this.params.onReady?.();
    }
    close(): void {}
  }
  class EventDispatcher {
    register(): this {
      return this;
    }
  }
  const sdk = {
    Client,
    WSClient,
    EventDispatcher,
    Domain: { Feishu: 0, Lark: 1 },
  } as unknown as LarkSdk;
  return { sdk, clients, sockets };
}

describe("createLarkTransport", () => {
  it("builds both clients with Domain.Lark for domain lark, and Domain.Feishu by default", async () => {
    const lark = fakeSdk();
    const toLark = createLarkTransport(
      { appId: APP_ID, appSecret: "s", domain: "lark" },
      async () => lark.sdk,
    );
    await toLark.tenantToken();
    await toLark.start({ onMessage: () => undefined, onError: () => undefined });
    const feishu = fakeSdk();
    const toFeishu = createLarkTransport({ appId: APP_ID, appSecret: "s" }, async () => feishu.sdk);
    await toFeishu.tenantToken();
    await toFeishu.start({ onMessage: () => undefined, onError: () => undefined });

    expect(lark.clients).toEqual([expect.objectContaining({ domain: 1 })]);
    expect(lark.sockets).toEqual([expect.objectContaining({ domain: 1 })]);
    expect(feishu.clients).toEqual([expect.objectContaining({ domain: 0 })]);
    expect(feishu.sockets).toEqual([expect.objectContaining({ domain: 0 })]);
  });

  it("leaves the SDK's reconnect on: the WSClient is built with autoReconnect not false (D7)", async () => {
    const { sdk, sockets } = fakeSdk();
    const transport = createLarkTransport({ appId: APP_ID, appSecret: "s" }, async () => sdk);
    await transport.start({ onMessage: () => undefined, onError: () => undefined });

    expect((sockets[0] as { autoReconnect?: boolean }).autoReconnect).not.toBe(false);
  });
});

describe("FeishuLarkAdapter.connect", () => {
  it("returns false when the tenant token call answers a non-zero code", async () => {
    const written = quiet();
    const transport = new FakeTransport();
    transport.token = async () => ({ code: 10003, msg: "invalid app_secret" });

    await expect(makeAdapter(transport).connect()).resolves.toBe(false);
    expect(written.join("")).toContain("10003");
  });

  it("resolves false within 10000 ms when the tenant token request never answers", async () => {
    vi.useFakeTimers();
    quiet();
    const transport = new FakeTransport();
    transport.token = () => new Promise(() => undefined);
    let answer: boolean | undefined;
    void makeAdapter(transport)
      .connect()
      .then((ok) => {
        answer = ok;
      });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(answer).toBe(false);
  });

  it("schedules no reconnect timer of its own (D7)", async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter(new FakeTransport());
    await adapter.connect();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("is left disconnected, with one stderr line and no throw, by an SDK onError after start (D7)", async () => {
    const written = quiet();
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();
    transport.handlers?.onError(new Error("reconnect attempts exhausted"));

    const result = await adapter.sendMessage({ channel: { id: "oc_chat", type: "dm" }, text: "x" });
    expect(result.error?.code).toBe("not_connected");
    expect(written.filter((line) => line.includes("reconnect attempts exhausted"))).toHaveLength(1);
  });

  it("does not open the long connection when the tenant token answers after the deadline", async () => {
    vi.useFakeTimers();
    quiet();
    const transport = new FakeTransport();
    let answerToken: (result: LarkApiResult) => void = () => undefined;
    transport.token = () =>
      new Promise((resolve) => {
        answerToken = resolve;
      });
    const adapter = makeAdapter(transport);
    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(connecting).resolves.toBe(false);
    answerToken({ code: 0 });
    await vi.advanceTimersByTimeAsync(0);

    expect(transport.handlers).toBeUndefined();
    const result = await adapter.sendMessage({ channel: { id: "oc_chat", type: "dm" }, text: "x" });
    expect(result.error?.code).toBe("not_connected");
  });

  it("does not open the long connection when disconnect() lands while the token is pending", async () => {
    const transport = new FakeTransport();
    let answerToken: (result: LarkApiResult) => void = () => undefined;
    transport.token = () =>
      new Promise((resolve) => {
        answerToken = resolve;
      });
    const adapter = makeAdapter(transport);
    const connecting = adapter.connect();
    await adapter.disconnect();
    answerToken({ code: 0 });

    await expect(connecting).resolves.toBe(false);
    expect(transport.handlers).toBeUndefined();
  });

  it("closes the long connection the SDK gave up on", async () => {
    quiet();
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();
    transport.handlers?.onError(new Error("gave up"));

    expect(transport.closed).toBe(1);
  });

  it("refuses an app id that is not cli_ and 16 hex characters at construction", () => {
    expect(
      () =>
        new FeishuLarkAdapter({ appId: "app-1", appSecret: "s", transport: new FakeTransport() }),
    ).toThrow(/cli_/);
  });
});

describe("FeishuLarkAdapter inbound", () => {
  it("returns from the dispatcher before a handler that waits 5000 ms finishes", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    let finished = false;
    adapter.onInbound(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      finished = true;
    });
    await adapter.connect();
    transport.dispatch(larkEvent());

    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(finished).toBe(true);
  });

  it("delivers an event_id dispatched twice once", async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    const seen: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      seen.push(event);
    });
    await adapter.connect();
    transport.dispatch(larkEvent({ eventId: "ev_dup" }));
    transport.dispatch(larkEvent({ eventId: "ev_dup" }));
    await drain();

    expect(seen).toHaveLength(1);
  });

  it("delivers the same event_id dispatched twice in one tick once", async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.connect();
    await Promise.all(
      [1, 2].map(async () => transport.dispatch(larkEvent({ eventId: "ev_tick" }))),
    );
    await drain();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("produces no event for a message an app sent", async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.connect();
    transport.dispatch(larkEvent({ senderType: "app" }));
    await drain();

    expect(handler).not.toHaveBeenCalled();
  });

  it("skips content that is not JSON with one stderr line, never throwing into the dispatcher (EC-13)", async () => {
    const written = quiet();
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.connect();

    expect(() => transport.dispatch(larkEvent({ content: "{oops" }))).not.toThrow();
    await drain();
    expect(handler).not.toHaveBeenCalled();
    expect(written.filter((line) => line.includes("not JSON"))).toHaveLength(1);
  });

  it("leaves a queued delivery undelivered when disconnect() runs first, and closes once", async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.connect();
    transport.dispatch(larkEvent());
    await adapter.disconnect();
    await drain();

    expect(handler).not.toHaveBeenCalled();
    expect(transport.closed).toBe(1);
  });

  it("logs a throwing handler as handler threw and delivers the next event", async () => {
    const written = quiet();
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    const texts: string[] = [];
    adapter.onInbound(async (event) => {
      texts.push(event.text);
      if (texts.length === 1) throw new Error("user code failed");
    });
    await adapter.connect();
    transport.dispatch(larkEvent({ eventId: "a" }));
    transport.dispatch(larkEvent({ eventId: "b" }));
    await until(() => texts.length === 2, "both events");

    expect(written.join("")).toContain("handler threw");
  });
});

describe("FeishuLarkAdapter.sendMessage", () => {
  it("returns empty_text before checking the connection", async () => {
    const result = await makeAdapter(new FakeTransport()).sendMessage({
      channel: { id: "oc_chat", type: "dm" },
      text: "",
    });

    expect(result.error?.code).toBe("empty_text");
  });

  it("creates a message in the chat, with markdown markers dropped", async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const result = await adapter.sendMessage({
      channel: { id: "oc_chat", type: "group" },
      text: "**hi**",
      format: "markdown",
    });

    expect(transport.created).toEqual([{ chatId: "oc_chat", text: "hi" }]);
    expect(result).toEqual({ ok: true, messageId: "om_sent" });
  });

  it("replies to the message replyTo names", async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    await adapter.sendMessage({
      channel: { id: "oc_chat", type: "dm" },
      text: "re",
      replyTo: "om_1",
    });

    expect(transport.replied).toEqual([{ messageId: "om_1", text: "re" }]);
  });

  it("turns a non-zero send code into lark_api_error with the code in the message", async () => {
    const transport = new FakeTransport();
    transport.send = async () => ({ code: 230002, msg: "bot is not in the chat" });
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const result = await adapter.sendMessage({ channel: { id: "oc_chat", type: "dm" }, text: "x" });

    expect(result).toEqual({
      ok: false,
      error: { code: "lark_api_error", message: "230002: bot is not in the chat" },
    });
  });

  it("turns a thrown SDK error into lark_api_error, never a throw", async () => {
    const transport = new FakeTransport();
    transport.send = async () => {
      throw new Error("socket hang up");
    };
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const result = await adapter.sendMessage({ channel: { id: "oc_chat", type: "dm" }, text: "x" });

    expect(result).toEqual({
      ok: false,
      error: { code: "lark_api_error", message: "socket hang up" },
    });
  });

  it("settles timeout after 30000 ms when im.message.create never answers", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    transport.send = () => new Promise(() => undefined);
    const adapter = makeAdapter(transport);
    await adapter.connect();
    let result: unknown;
    void adapter.sendMessage({ channel: { id: "oc_chat", type: "dm" }, text: "x" }).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
  });
});
