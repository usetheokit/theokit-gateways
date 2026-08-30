/**
 * `TeamsAdapter` tests (T1.3 + EC-1, EC-7).
 */

import { BasePlatformAdapter } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";

/** Minimal fake App matching the TeamsAppLike contract from adapter.ts. */
function makeFakeApp() {
  const handlers: Record<string, (e: unknown) => Promise<void> | void> = {};
  let started = false;
  return {
    initialize: vi.fn(async () => {}),
    start: vi.fn(async () => {
      started = true;
    }),
    stop: vi.fn(async () => {
      started = false;
    }),
    send: vi.fn(async (_conversationId: string, _activity: unknown) => ({ id: "sent-1" })),
    on: vi.fn((name: string, cb: (e: unknown) => void | Promise<void>) => {
      handlers[name] = cb;
    }),
    /** Test helper — invoke the registered "activity" handler with a synthetic event. */
    _emit(name: string, event: unknown) {
      return handlers[name]?.(event);
    },
    get _started() {
      return started;
    },
    get _handlers() {
      return handlers;
    },
  };
}

/**
 * A credential Microsoft accepts.
 *
 * `connect()` asks Entra whether the three credentials are real, so a unit test that does not
 * inject this reaches the network and is rejected — these credentials are `client-1` / `secret-1`.
 * Injecting it keeps the assertion on the behaviour under test and keeps I/O out of a unit test.
 */
const acceptedCredential = async () => ({ ok: true, status: 200 });

function makeAdapter(opts: { botDisplayName?: string } = {}) {
  const fakeApp = makeFakeApp();
  const adapter = new TeamsAdapter({
    clientId: "client-1",
    clientSecret: "secret-1",
    tenantId: "tenant-1",
    botDisplayName: opts.botDisplayName,
    __appFactory: () => fakeApp as never,
    __tokenFetcher: acceptedCredential,
  });
  return { adapter, fakeApp };
}

describe("TeamsAdapter — Base contract", () => {
  it("test_adapter_is_base_platform_adapter", () => {
    const { adapter } = makeAdapter();
    expect(adapter).toBeInstanceOf(BasePlatformAdapter);
  });

  it("test_adapter_platform_is_teams", () => {
    const { adapter } = makeAdapter();
    expect(adapter.platform).toBe("teams");
  });
});

describe("TeamsAdapter — Constructor validation (EC-1)", () => {
  it("test_adapter_constructor_validates_non_empty (EC-1) — empty clientId throws", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "",
        clientSecret: "s",
        tenantId: "t",
      });
    }).toThrow(/clientId/);
  });

  it("test_adapter_constructor_validates_empty_secret", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "c",
        clientSecret: "",
        tenantId: "t",
      });
    }).toThrow(/clientSecret/);
  });

  it("test_adapter_constructor_validates_empty_tenant", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "c",
        clientSecret: "s",
        tenantId: "",
      });
    }).toThrow(/tenantId/);
  });

  it("constructor accepts valid non-empty options", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "c",
        clientSecret: "s",
        tenantId: "t",
        __appFactory: () => ({}) as never,
      });
    }).not.toThrow();
  });
});

describe("TeamsAdapter — lifecycle", () => {
  it("test_connect_returns_true_on_success", async () => {
    const { adapter, fakeApp } = makeAdapter();
    expect(await adapter.connect()).toBe(true);
    expect(fakeApp.initialize).toHaveBeenCalledTimes(1);
  });

  it("test_connect_idempotent — second call returns true without re-init", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    await adapter.connect();
    expect(fakeApp.initialize).toHaveBeenCalledTimes(1);
  });

  it("test_connect_returns_false_on_init_failure", async () => {
    const failApp = makeFakeApp();
    failApp.initialize = vi.fn(async () => {
      throw new Error("init failed");
    });
    const adapter = new TeamsAdapter({
      clientId: "c",
      clientSecret: "s",
      tenantId: "t",
      __appFactory: () => failApp as never,
      __tokenFetcher: acceptedCredential,
    });
    expect(await adapter.connect()).toBe(false);
  });

  it("test_disconnect_idempotent — second call is noop", async () => {
    const { adapter } = makeAdapter();
    await adapter.connect();
    await adapter.disconnect();
    await adapter.disconnect();
    // No throw.
  });

  it("test_disconnect_clears_seen_conversations", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    adapter.onInbound(async () => {});
    await fakeApp._emit("activity", {
      activity: {
        type: "message",
        id: "act-1",
        text: "hi",
        conversation: { id: "conv-1", conversationType: "personal" },
        from: { id: "u1" },
      },
    });
    expect(adapter._seenConversationsSize).toBe(1);
    await adapter.disconnect();
    expect(adapter._seenConversationsSize).toBe(0);
  });
});

describe("TeamsAdapter — onInbound + dispatch", () => {
  it("test_adapter_oninbound_replaces (EC-H)", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const h1 = vi.fn(async () => {});
    const h2 = vi.fn(async () => {});
    adapter.onInbound(h1);
    adapter.onInbound(h2);
    await fakeApp._emit("activity", {
      activity: {
        type: "message",
        id: "act-1",
        text: "hi",
        conversation: { id: "conv-1", conversationType: "personal" },
        from: { id: "u1" },
      },
    });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("a stale unsubscribe does not clear the handler that replaced it", async () => {
    // onInbound(A) -> onInbound(B) -> A's unsubscribe. Without an identity guard
    // A's closure cleared B and inbound delivery stopped permanently, with
    // nothing logged. Teams and email were the only two adapters of ten missing
    // the guard, and no test anywhere ran this order.
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const h1 = vi.fn(async () => {});
    const h2 = vi.fn(async () => {});
    const offFirst = adapter.onInbound(h1);
    adapter.onInbound(h2);

    offFirst(); // stale: belongs to a handler that is no longer installed

    await fakeApp._emit("activity", {
      activity: {
        type: "message",
        id: "act-stale",
        text: "hi",
        conversation: { id: "conv-stale", conversationType: "personal" },
        from: { id: "u1" },
      },
    });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("its own unsubscribe still clears the current handler", async () => {
    // Guards the guard: an identity check that never matches would silently
    // disable unsubscribe altogether.
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const h = vi.fn(async () => {});
    const off = adapter.onInbound(h);
    off();
    await fakeApp._emit("activity", {
      activity: {
        type: "message",
        id: "act-off",
        text: "hi",
        conversation: { id: "conv-off", conversationType: "personal" },
        from: { id: "u1" },
      },
    });
    expect(h).not.toHaveBeenCalled();
  });

  it("filters non-message activities (typing, conversationUpdate)", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const h = vi.fn(async () => {});
    adapter.onInbound(h);
    await fakeApp._emit("activity", {
      activity: { type: "typing", conversation: { id: "c" } },
    });
    await fakeApp._emit("activity", {
      activity: { type: "conversationUpdate", conversation: { id: "c" } },
    });
    expect(h).not.toHaveBeenCalled();
  });

  it("test_adapter_seenConversations_caps_at_max (EC-5 downgraded)", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    adapter.onInbound(async () => {});
    // Push 1005 distinct conversation ids.
    for (let i = 0; i < 1005; i += 1) {
      await fakeApp._emit("activity", {
        activity: {
          type: "message",
          id: `act-${i}`,
          text: "hi",
          conversation: { id: `conv-${i}`, conversationType: "personal" },
          from: { id: "u1" },
        },
      });
    }
    expect(adapter._seenConversationsSize).toBeLessThanOrEqual(1000);
  });
});

describe("TeamsAdapter — a throwing handler", () => {
  it("is contained and logged, instead of taking the process down", async () => {
    // `this.app.on("activity", (event) => { void this._dispatchActivity(event); })` discarded the
    // promise. `void` says "I am not waiting"; what it tells the runtime is "I am not handling the
    // error". Under Node 22's default that rejection is unhandled and the process dies — measured:
    // one message with a throwing handler ended the run with exit code 1 (#41). Eight of the ten
    // adapters already contained it; this one and whatsapp-web did not.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    adapter.onInbound(async () => {
      throw new Error("user handler blew up");
    });

    await fakeApp._emit("activity", {
      activity: {
        type: "message",
        id: "act-throw",
        text: "hi",
        conversation: { id: "conv-1", conversationType: "personal" },
        from: { id: "u1" },
      },
    });
    // The dispatch is deliberately not awaited by the platform callback, so give the rejection a
    // turn to surface before asking whether it was contained.
    await new Promise((r) => setTimeout(r, 0));

    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("[teams] handler threw: user handler blew up");
    stderr.mockRestore();
  });

  it("keeps delivering after a handler throws", async () => {
    // Containment is only worth anything if the next message still arrives.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const seen: string[] = [];
    adapter.onInbound(async (event) => {
      seen.push(event.text);
      if (event.text === "boom") throw new Error("user handler blew up");
    });

    const emit = (text: string) =>
      fakeApp._emit("activity", {
        activity: {
          type: "message",
          id: `act-${text}`,
          text,
          conversation: { id: "conv-1", conversationType: "personal" },
          from: { id: "u1" },
        },
      });
    await emit("boom");
    await new Promise((r) => setTimeout(r, 0));
    await emit("after");
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual(["boom", "after"]);
    stderr.mockRestore();
  });
});

describe("TeamsAdapter — sendMessage", () => {
  it("test_adapter_send_with_empty_text_returns_error", async () => {
    const { adapter } = makeAdapter();
    await adapter.connect();
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
  });

  it("test_adapter_send_not_connected_returns_error", async () => {
    const { adapter } = makeAdapter();
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not_connected");
  });

  it("test_adapter_send_short_message_one_send_call", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const r = await adapter.sendMessage({
      channel: { id: "conv-1", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(true);
    expect(fakeApp.send).toHaveBeenCalledTimes(1);
    expect(fakeApp.send).toHaveBeenCalledWith("conv-1", { type: "message", text: "hi" });
  });

  it("test_adapter_send_app_throws_returns_error", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    fakeApp.send = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("server_error"); // EC-7: network error mapped
  });

  it("test_adapter_send_returns_last_activity_id", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    let i = 0;
    fakeApp.send = vi.fn(async () => ({ id: `act-${++i}` }));
    // Force split: 8500-char text.
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "a".repeat(8500),
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe(`act-${i}`); // last call's id
    expect((fakeApp.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("TeamsAdapter — the format the caller declared", () => {
  /**
   * The activity carries `textFormat`, and without it Teams renders markup as characters.
   * `OutboundMessage.format` was read by nobody here, so a caller saying "this is markdown"
   * was telling the adapter something it discarded.
   */
  it("sets textFormat on the activity when the caller declares markdown", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();

    const res = await adapter.sendMessage({
      channel: { id: "conv-1", type: "group" },
      text: "**bold**",
      format: "markdown",
    });

    expect(res.ok).toBe(true);
    const activity = fakeApp.send.mock.calls[0]?.[1] as { textFormat?: string };
    expect(activity.textFormat).toBe("markdown");
  });

  it("omits textFormat when no format is declared", async () => {
    // The absence is the assertion: sending `textFormat` unconditionally would ask Teams to
    // parse markup in a message the caller never said contained any.
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();

    await adapter.sendMessage({ channel: { id: "conv-1", type: "group" }, text: "plain" });

    const activity = fakeApp.send.mock.calls[0]?.[1] as { textFormat?: string };
    expect(activity.textFormat).toBeUndefined();
  });
});

describe("TeamsAdapter — html is not markdown, and a rejected activity degrades", () => {
  it("declares html as xml, the type Teams actually has for it", async () => {
    // Review found `html` being declared as markdown: the tags render literally AND any `*` or
    // `_` in the payload is emphasised, so the caller gets the opposite of both intentions.
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();

    await adapter.sendMessage({
      channel: { id: "conv-1", type: "group" },
      text: "<b>save</b>",
      format: "html",
    });

    const activity = fakeApp.send.mock.calls[0]?.[1] as { textFormat?: string };
    expect(activity.textFormat).toBe("xml");
  });

  it("retries as plain text when the service rejects the formatted activity", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    let attempt = 0;
    fakeApp.send.mockImplementation(async (_id: string, activity: { textFormat?: string }) => {
      attempt += 1;
      if (activity.textFormat !== undefined) {
        throw Object.assign(new Error("bad activity"), { statusCode: 400 });
      }
      return { id: "sent-plain" };
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const res = await adapter.sendMessage({
      channel: { id: "conv-1", type: "group" },
      text: "**bold**",
      format: "markdown",
    });

    expect(res.ok).toBe(true);
    expect(attempt).toBe(2);
    stderr.mockRestore();
  });

  it("does NOT retry when the service refuses the caller", async () => {
    // The discrimination is the point: retrying a 401 without markup fails identically and
    // reports a formatting problem where there is an authentication one.
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    let attempt = 0;
    fakeApp.send.mockImplementation(async () => {
      attempt += 1;
      throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    });

    const res = await adapter.sendMessage({
      channel: { id: "conv-1", type: "group" },
      text: "**bold**",
      format: "markdown",
    });

    expect(res.ok).toBe(false);
    expect(attempt, "retried a failure that was never about formatting").toBe(1);
  });
});
