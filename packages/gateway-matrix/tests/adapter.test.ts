import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";
import type { MatrixSdkClient } from "../src/client.js";
import { ConfigurationError } from "../src/errors.js";
import type { MatrixEventLike, MatrixRoomLike } from "../src/types.js";

function makeMockClient(): MatrixSdkClient & {
  /** How many times `stopClient()` was called — the observable behind "idempotent". */
  stopped: number;
  sent: Array<{ roomId: string; text: string }>;
  listeners: Array<(e: MatrixEventLike, r: MatrixRoomLike) => void>;
  failNextSendWith?: { httpStatus?: number; errcode?: string; message?: string };
  /** Drives the credential-validation path — see the connect() regression test. */
  failWhoamiWith?: Error;
  encryptedRooms: Set<string>;
  resolved: Record<string, string>;
} {
  const sent: Array<{ roomId: string; text: string }> = [];
  const listeners: Array<(e: MatrixEventLike, r: MatrixRoomLike) => void> = [];
  const encryptedRooms = new Set<string>();
  const resolved: Record<string, string> = {};
  const c = {
    stopped: 0,
    sent,
    listeners,
    encryptedRooms,
    resolved,
    failNextSendWith: undefined as
      | { httpStatus?: number; errcode?: string; message?: string }
      | undefined,
    failWhoamiWith: undefined as Error | undefined,
    on(_evt: "Room.timeline", l: (e: MatrixEventLike, r: MatrixRoomLike) => void) {
      listeners.push(l);
    },
    off(_evt: "Room.timeline", l: (e: MatrixEventLike, r: MatrixRoomLike) => void) {
      const idx = listeners.indexOf(l);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    async whoami() {
      const self = this as unknown as { failWhoamiWith?: Error };
      if (self.failWhoamiWith !== undefined) throw self.failWhoamiWith;
      return { user_id: "@bot:example.org" };
    },
    async startClient() {
      return undefined;
    },
    stopClient() {
      // Counted, not a noop: "idempotent" is a claim about HOW MANY times the client is stopped,
      // and a test that only checks for the absence of a throw cannot see a second stop. The
      // sibling `gateway-mattermost` asserts `handle.closed === 1` for the same reason.
      (c as unknown as { stopped: number }).stopped += 1;
    },
    async sendTextMessage(roomId: string, text: string) {
      const self = this as unknown as {
        failNextSendWith?: { httpStatus?: number; message?: string };
      };
      if (self.failNextSendWith !== undefined) {
        const e = self.failNextSendWith;
        self.failNextSendWith = undefined;
        throw Object.assign(new Error(e.message ?? "fail"), e);
      }
      sent.push({ roomId, text });
      return { event_id: `$evt-${sent.length}:server` };
    },
    async getRoomIdForAlias(alias: string) {
      const room_id = resolved[alias] ?? `!resolved-${alias}:server`;
      return { room_id };
    },
    getRoom() {
      return null;
    },
    isRoomEncrypted(roomId: string) {
      return encryptedRooms.has(roomId);
    },
    getUserId() {
      return "@bot:matrix.org";
    },
  };
  return c as unknown as MatrixSdkClient & typeof c;
}

function makeEvent(
  opts?: Partial<{
    id: string;
    sender: string;
    type: string;
    body: string;
    ts: number;
  }>,
): MatrixEventLike {
  return {
    getId: () => opts?.id ?? "evt-1",
    getSender: () => opts?.sender ?? "@alice:matrix.org",
    getRoomId: () => "!r:server",
    getType: () => opts?.type ?? "m.room.message",
    getContent: () => ({ body: opts?.body ?? "hi", msgtype: "m.text" }),
    getTs: () => opts?.ts ?? Date.now(),
  };
}

function makeRoom(memberCount = 2, roomId = "!r:server"): MatrixRoomLike {
  return { roomId, getJoinedMemberCount: () => memberCount };
}

// One helper, one assertion, and it checks the pair that matters: the error TYPE and the `code` a
// caller branches on. Every field below raises the SAME ConfigurationError, so a check on the type
// alone stays green if the constructor reports the WRONG field — and the field is the entire content
// of the diagnostic. `code` rather than the message because it is the machine-readable half of the
// contract; the prose is free to be reworded.
function configErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err, "threw something that is not a ConfigurationError").toBeInstanceOf(
      ConfigurationError,
    );
    return (err as ConfigurationError).code;
  }
  throw new Error("expected a ConfigurationError, nothing was thrown");
}

describe("MatrixAdapter constructor", () => {
  // The separate "carries actionable code" case that used to close this block is folded in: it
  // re-tested the homeserver path the first case already covers, and asserted strictly less than
  // what all three now assert.
  it("throws on empty homeserverUrl", () => {
    expect(
      configErrorCode(
        () =>
          new MatrixAdapter({
            homeserverUrl: "",
            accessToken: "t",
            userId: "@bot:matrix.org",
          }),
      ),
    ).toBe("homeserver_url_required");
  });

  it("throws on empty accessToken", () => {
    expect(
      configErrorCode(
        () =>
          new MatrixAdapter({
            homeserverUrl: "https://matrix.org",
            accessToken: "",
            userId: "@bot:matrix.org",
          }),
      ),
    ).toBe("access_token_required");
  });

  it("throws on userId without @ prefix", () => {
    expect(
      configErrorCode(
        () =>
          new MatrixAdapter({
            homeserverUrl: "https://matrix.org",
            accessToken: "t",
            userId: "bot:matrix.org",
          }),
      ),
    ).toBe("user_id_required");
  });
});

describe("MatrixAdapter.sendMessage", () => {
  it("rejects empty text", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    adapter._installClient(makeMockClient());
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  });

  it("not_connected when client undefined", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
  });

  it("sends via room id", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(true);
    expect(client.sent[0]).toEqual({ roomId: "!r:server", text: "hi" });
  });

  it("resolves alias before sending (D419)", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.resolved["#general:matrix.org"] = "!resolved:server";
    adapter._installClient(client);
    await adapter.sendMessage({
      channel: { id: "#general:matrix.org", type: "group" },
      text: "hi",
    });
    expect(client.sent[0]?.roomId).toBe("!resolved:server");
  });

  it("refuses E2EE room with encrypted_room_unsupported (D418)", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.encryptedRooms.add("!enc:server");
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!enc:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("encrypted_room_unsupported");
    expect(client.sent).toHaveLength(0);
  });

  it("maps M_LIMIT_EXCEEDED to rate_limit", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.failNextSendWith = { errcode: "M_LIMIT_EXCEEDED", message: "slow" };
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("rate_limit");
  });

  it("maps M_FORBIDDEN to permission_denied", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.failNextSendWith = { errcode: "M_FORBIDDEN", message: "nope" };
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("permission_denied");
  });
});

describe("MatrixAdapter inbound dispatch", () => {
  it("dispatches a fresh event via timeline listener", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
    expect(received[0]?.platform).toBe("matrix");
    if (received[0]?.platform === "matrix") {
      expect(received[0].channel.type).toBe("dm");
    }
  });

  it("EC-3: ignores events older than 60s", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() - 90_000 }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).not.toHaveBeenCalled();
  });

  it("loop guard: ignores bot's own messages", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@bot:matrix.org", ts: Date.now() }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips encrypted rooms (D418)", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.encryptedRooms.add("!enc:server");
    adapter._installClient(client);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), {
      roomId: "!enc:server",
      getJoinedMemberCount: () => 2,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).not.toHaveBeenCalled();
  });

  it("EC-H: onInbound replaces previous handler", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    adapter.onInbound(a);
    adapter.onInbound(b);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("handler throw isolated", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    adapter.onInbound(async () => {
      throw new Error("boom");
    });
    const listener = client.listeners[0];
    expect(() =>
      listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), makeRoom(2)),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
  });
});

describe("MatrixAdapter lifecycle", () => {
  it("connect() reports failure when the server rejects the access token", async () => {
    // Regression, found by the live suite against a real homeserver on
    // 2026-08-17. `startClient` begins syncing ASYNCHRONOUSLY and resolves
    // whether or not the token is valid — matrix-js-sdk logs the 401 as
    // "continuing to initialise sync, this will be retried later" and carries
    // on. So connect() answered `true` for a credential the server had already
    // rejected, and the operator got a healthy-looking adapter that received
    // nothing, forever.
    //
    // Every sibling adapter returns false here; Matrix was the one that did not.
    // `whoami()` is the cheapest call that makes the server judge the token.
    const client = makeMockClient();
    client.failWhoamiWith = Object.assign(new Error("Invalid token"), {
      errcode: "M_UNKNOWN_TOKEN",
      httpStatus: 401,
    });
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "invalid",
      userId: "@bot:example.org",
      __clientFactory: () => client,
    });

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await adapter.connect()).toBe(false);
    stderr.mockRestore();
  });

  it("reconnects after an explicit disconnect", async () => {
    // A guard that never clears is a latch: connect() would answer true forever while building
    // nothing, leaving a bot that is silent and looks healthy. Deleting the clear in disconnect()
    // left every test in this package passing until this one existed.
    let built = 0;
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "t",
      userId: "@bot:example.org",
      __clientFactory: () => {
        built += 1;
        return makeMockClient();
      },
    });

    expect(await adapter.connect()).toBe(true);
    await adapter.disconnect();
    expect(await adapter.connect()).toBe(true);

    expect(built, "the second connect() never built a client").toBe(2);
    await adapter.disconnect();
  });

  describe("teardown aborts do not kill the host process (issue #12)", () => {
    /** Connects with a stubbed global fetch and hands back the SDK's fetchFn. */
    async function connectCapturingFetchFn(): Promise<{
      adapter: MatrixAdapter;
      fetchFn: typeof globalThis.fetch;
      abort: () => void;
    }> {
      let rejectWithAbort: (() => void) | undefined;
      const stub = vi.fn(
        () =>
          new Promise<Response>((_res, rej) => {
            rejectWithAbort = () => {
              rej(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
            };
          }),
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(stub as unknown as typeof globalThis.fetch);

      let captured: typeof globalThis.fetch | undefined;
      const adapter = new MatrixAdapter({
        homeserverUrl: "https://matrix.example.org",
        accessToken: "t",
        userId: "@bot:example.org",
        __clientFactory: (cfg: unknown) => {
          captured = (cfg as { fetchFn?: typeof globalThis.fetch }).fetchFn;
          return makeMockClient();
        },
      } as never);
      await adapter.connect();
      if (captured === undefined) throw new Error("adapter did not pass fetchFn to the SDK");
      return { adapter, fetchFn: captured, abort: () => rejectWithAbort?.() };
    }

    /** Resolves "settled" or "pending" — never hangs the test. */
    async function settlesWithin(p: Promise<unknown>, ms: number): Promise<string> {
      return Promise.race([
        p.then(
          () => "settled",
          () => "settled",
        ),
        new Promise<string>((r) => setTimeout(() => r("pending"), ms)),
      ]);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("leaves an abort unsettled while tearing down", async () => {
      // The rejecting promise is the SDK's own request wrapper, which nothing
      // catches and we cannot reach. Unsettled costs a continuation; rejected
      // ends the process. Measured against a real homeserver before this fix:
      // 7 unhandled rejections in 8 connect/disconnect cycles.
      const { adapter, fetchFn, abort } = await connectCapturingFetchFn();
      const inFlight = fetchFn("https://matrix.example.org/_matrix/client/v3/sync");
      await adapter.disconnect();
      abort();

      expect(await settlesWithin(inFlight, 50)).toBe("pending");
    });

    it("still rejects an abort outside teardown", async () => {
      // Scope matters as much as the fix. A consumer using the getClient()
      // escape hatch (D421) can pass its own abort signal to search() or
      // slidingSync(), and swallowing those would hang it instead of the
      // process. Outside the teardown window every error propagates.
      const { fetchFn, abort } = await connectCapturingFetchFn();
      const inFlight = fetchFn("https://matrix.example.org/_matrix/client/v3/search");
      abort();

      await expect(inFlight).rejects.toThrow(/aborted/i);
    });
  });

  it("disconnect is idempotent", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    await adapter.disconnect();
    await adapter.disconnect();

    // "no throw" was the whole assertion here, and it cannot tell an idempotent disconnect from one
    // that stops an already-stopped client — the second stop would throw nowhere and pass. The count
    // is what carries the claim.
    expect(client.stopped, "the client was stopped more than once").toBe(1);
  });

  it("getClient returns the underlying client (escape hatch)", () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    expect(adapter.getClient()).toBe(client);
  });
});

describe("MatrixAdapter — the format the caller declared", () => {
  /**
   * Matrix declares its markup type in `format`, and the only value is
   * `org.matrix.custom.html`. That is a promise to every client that `formatted_body` IS HTML.
   *
   * The first version of this feature broke that promise: it put the caller's MARKDOWN there
   * and declared it HTML. Review demonstrated the cost — `Use <div> for 5 < 3` arrives with the
   * tag parsed and dropped, so the reader loses words the sender wrote — and the test that
   * "proved" the feature was asserting exactly that defect.
   */
  it("sends formatted_body only when the caller declares html", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = makeMockClient();
    (client as unknown as { sendMessage: unknown }).sendMessage = async (
      _roomId: string,
      content: Record<string, unknown>,
    ) => {
      sent.push(content);
      return { event_id: "$formatted" };
    };
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "t",
      userId: "@bot:example.org",
      __clientFactory: () => client,
    });
    await adapter.connect();

    const res = await adapter.sendMessage({
      channel: { id: "!room:example.org", type: "group" },
      text: "<b>bold</b>",
      format: "html",
    });

    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.format).toBe("org.matrix.custom.html");
    expect(sent[0]?.formatted_body).toBe("<b>bold</b>");
  });

  it("never puts markdown in the HTML field, and says so once", async () => {
    // The regression for the defect above. Markdown in `formatted_body` renders as literal
    // asterisks anyway — so the branch bought nothing and cost content corruption.
    const sent: Array<Record<string, unknown>> = [];
    const client = makeMockClient();
    (client as unknown as { sendMessage: unknown }).sendMessage = async (
      _roomId: string,
      content: Record<string, unknown>,
    ) => {
      sent.push(content);
      return { event_id: "$nope" };
    };
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "t",
      userId: "@bot:example.org",
      __clientFactory: () => client,
    });
    await adapter.connect();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await adapter.sendMessage({
      channel: { id: "!room:example.org", type: "group" },
      text: "**bold**",
      format: "markdown",
    });
    await adapter.sendMessage({
      channel: { id: "!room:example.org", type: "group" },
      text: "**more**",
      format: "markdown",
    });

    expect(sent, "markdown reached the HTML field").toHaveLength(0);
    const warned = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("no markdown mode"));
    expect(warned, "warned per message instead of once").toHaveLength(1);
    stderr.mockRestore();
  });

  it("leaves a plain message on the convenience call, with the formatted path available", async () => {
    // The reviewer proved the previous version of this test was vacuous: the mock had no
    // `sendMessage` at all, so the plain path was forced no matter what the adapter decided.
    // Deleting the guard left all 53 tests green. The mock now HAS the formatted path, so the
    // assertion is that the adapter chose not to take it.
    const sent: Array<Record<string, unknown>> = [];
    const client = makeMockClient();
    (client as unknown as { sendMessage: unknown }).sendMessage = async (
      _roomId: string,
      content: Record<string, unknown>,
    ) => {
      sent.push(content);
      return { event_id: "$should-not-happen" };
    };
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "t",
      userId: "@bot:example.org",
      __clientFactory: () => client,
    });
    await adapter.connect();

    const res = await adapter.sendMessage({
      channel: { id: "!room:example.org", type: "group" },
      text: "plain words",
    });

    expect(res.ok).toBe(true);
    expect(sent, "a plain message took the formatted path").toHaveLength(0);
  });
});

describe("MatrixAdapter — markup the homeserver refuses", () => {
  /**
   * ADR-2 of the B-020 plan: an undelivered message is worse than an unformatted one. The
   * caller loses the content and the user sees nothing, which is a strictly worse outcome
   * than losing the bold.
   *
   * The catch is narrow on purpose. A bare `catch` here would swallow an expired token as a
   * formatting problem and retry into the same 401, turning an actionable error into a silent
   * double failure — the risk the plan's Drawbacks section names.
   */
  it("retries without the markup when the homeserver rejects the formatted body", async () => {
    const client = makeMockClient();
    let formattedAttempts = 0;
    (client as unknown as { sendMessage: unknown }).sendMessage = async () => {
      formattedAttempts += 1;
      throw Object.assign(new Error("bad html"), { httpStatus: 400, errcode: "M_BAD_JSON" });
    };
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "t",
      userId: "@bot:example.org",
      __clientFactory: () => client,
    });
    await adapter.connect();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const res = await adapter.sendMessage({
      channel: { id: "!room:example.org", type: "group" },
      text: "<b>bold</b>",
      format: "html",
    });

    expect(res.ok).toBe(true);
    expect(formattedAttempts).toBe(1);
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(logged).toContain("gateway-matrix");
    stderr.mockRestore();
  });

  it("does NOT retry when the failure is a permission error", async () => {
    // The discrimination is the point. Retrying a 403 without markup would fail identically
    // and report a formatting problem where there is an authentication one.
    const client = makeMockClient();
    (client as unknown as { sendMessage: unknown }).sendMessage = async () => {
      throw Object.assign(new Error("forbidden"), { httpStatus: 403, errcode: "M_FORBIDDEN" });
    };
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "t",
      userId: "@bot:example.org",
      __clientFactory: () => client,
    });
    await adapter.connect();

    const res = await adapter.sendMessage({
      channel: { id: "!room:example.org", type: "group" },
      text: "<b>bold</b>",
      format: "html",
    });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("permission_denied");
  });
});
