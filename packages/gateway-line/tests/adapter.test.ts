import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { LineAdapter } from "../src/adapter.js";
import type { LineSdkClient } from "../src/client.js";
import { ConfigurationError } from "../src/errors.js";
import type { LineWebhookEnvelope, LineWebhookEvent } from "../src/types.js";

function makeMockClient(): LineSdkClient & {
  replyCalls: Array<{ token: string; messages: unknown[] }>;
  pushCalls: Array<{ to: string; messages: unknown[] }>;
  failNextWith?: unknown;
  /** Drives the credential-validation path in connect(). */
  failBotInfoWith?: unknown;
} {
  const replyCalls: Array<{ token: string; messages: unknown[] }> = [];
  const pushCalls: Array<{ to: string; messages: unknown[] }> = [];
  return {
    replyCalls,
    pushCalls,
    failNextWith: undefined,
    failBotInfoWith: undefined,
    async replyMessage(token, messages) {
      const self = this as { failNextWith?: unknown };
      if (self.failNextWith !== undefined) {
        const err = self.failNextWith;
        self.failNextWith = undefined;
        throw err;
      }
      replyCalls.push({ token, messages: [...messages] });
      return undefined;
    },
    async getBotInfo() {
      const self = this as { failBotInfoWith?: unknown };
      if (self.failBotInfoWith !== undefined) throw self.failBotInfoWith;
      return { userId: "Ubot", displayName: "theokit-bot" };
    },
    async pushMessage(to, messages) {
      const self = this as { failNextWith?: unknown };
      if (self.failNextWith !== undefined) {
        const err = self.failNextWith;
        self.failNextWith = undefined;
        throw err;
      }
      pushCalls.push({ to, messages: [...messages] });
      return undefined;
    },
  } as LineSdkClient & {
    replyCalls: Array<{ token: string; messages: unknown[] }>;
    pushCalls: Array<{ to: string; messages: unknown[] }>;
    failNextWith?: unknown;
    failBotInfoWith?: unknown;
  };
}

function installMockClient(adapter: LineAdapter, client: LineSdkClient): void {
  (adapter as unknown as { client: LineSdkClient }).client = client;
  (adapter as unknown as { connected: boolean }).connected = true;
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

describe("LineAdapter constructor", () => {
  // The "carries actionable code" case that used to close this block is folded in: it re-tested the
  // channelSecret path the first case already covers, and only ONE of the two fields had its code
  // checked at all — an adapter that reported `channel_secret_required` for a missing access token
  // passed the whole block.
  it("throws on empty channelSecret (D408)", () => {
    expect(
      configErrorCode(
        () =>
          new LineAdapter({
            channelSecret: "",
            channelAccessToken: "tok",
          }),
      ),
    ).toBe("channel_secret_required");
  });

  it("throws on empty channelAccessToken", () => {
    expect(
      configErrorCode(
        () =>
          new LineAdapter({
            channelSecret: "secret",
            channelAccessToken: "",
          }),
      ),
    ).toBe("access_token_required");
  });
});

describe("LineAdapter.sendMessage", () => {
  it("empty text returns SendResult{empty_text}", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  });

  it("not_connected when adapter wasn't connected", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
  });

  it("uses reply token first when available", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter._cacheReplyToken("U-alice", "rtok-1");
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(true);
    expect(client.replyCalls).toHaveLength(1);
    expect(client.replyCalls[0]?.token).toBe("rtok-1");
    // The fake records the message payload, and across this whole file only
    // `.token` and `.length` were ever read — so sendMessage could have sent
    // empty text, or the wrong part, and every test still passed. Every sibling
    // adapter asserts the payload; this one now does too.
    expect(client.replyCalls[0]?.messages).toEqual([{ type: "text", text: "hi" }]);
    expect(client.pushCalls).toHaveLength(0);
  });

  it("sends to the requested recipient, with the requested text", async () => {
    // The recipient was never asserted anywhere. `pushMessage` could have been
    // called with the wrong targetId — another user's channel — and nothing in
    // the suite would have noticed.
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);

    await adapter.sendMessage({ channel: { id: "U-bob", type: "dm" }, text: "for bob" });

    expect(client.pushCalls[0]?.to).toBe("U-bob");
    expect(client.pushCalls[0]?.messages).toEqual([{ type: "text", text: "for bob" }]);
  });

  it("sends every part in order, none dropped or repeated", async () => {
    // With only length assertions, sending parts[i-1] on every iteration — a
    // classic off-by-one — produced the right CALL COUNT and passed.
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    const long = `${"a".repeat(4000)}\n\n${"b".repeat(4000)}`;

    await adapter.sendMessage({ channel: { id: "U-alice", type: "dm" }, text: long });

    const sent = client.pushCalls.map((c) => (c.messages[0] as { text: string }).text);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.join("").replace(/\n/g, "")).toBe(long.replace(/\n/g, ""));
    expect(new Set(sent).size).toBe(sent.length);
  });

  it("falls back to push API when no reply token cached", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(true);
    expect(client.replyCalls).toHaveLength(0);
    expect(client.pushCalls).toHaveLength(1);
  });

  it("reply token is one-shot — second send uses push (D407)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter._cacheReplyToken("U-alice", "rtok-1");
    await adapter.sendMessage({ channel: { id: "U-alice", type: "dm" }, text: "1" });
    await adapter.sendMessage({ channel: { id: "U-alice", type: "dm" }, text: "2" });
    expect(client.replyCalls).toHaveLength(1);
    expect(client.pushCalls).toHaveLength(1);
  });

  it("multipart: first part uses reply, subsequent use push (D407 + D411)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter._cacheReplyToken("U-alice", "rtok-1");
    await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "x".repeat(7_000), // 2 parts at 5000-cap
    });
    expect(client.replyCalls).toHaveLength(1);
    expect(client.pushCalls).toHaveLength(1);
  });

  it("maps 429 to rate_limit", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    client.failNextWith = Object.assign(new Error("slow down"), { statusCode: 429 });
    installMockClient(adapter, client);
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("rate_limit");
  });

  it("maps 401 to permission_denied", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    client.failNextWith = Object.assign(new Error("forbidden"), { statusCode: 401 });
    installMockClient(adapter, client);
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("permission_denied");
  });
});

describe("LineAdapter.dispatchWebhookBody (inbound)", () => {
  function makeEnv(events: LineWebhookEvent[]): LineWebhookEnvelope {
    return { events };
  }

  it("dispatches text DM to handler", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "rtok",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ]),
    );
    expect(received).toHaveLength(1);
    expect(received[0]?.platform).toBe("line");
    if (received[0]?.platform === "line") {
      expect(received[0].channel.type).toBe("dm");
    }
  });

  it("EC-4: ignores non-message events", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.dispatchWebhookBody(
      makeEnv([
        { type: "follow", source: { type: "user", userId: "U-a" } },
        { type: "unfollow", source: { type: "user", userId: "U-a" } },
        { type: "postback", source: { type: "user", userId: "U-a" } },
      ]),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("EC-4: ignores non-text messages (image/sticker)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-a" },
          replyToken: "r",
          message: { type: "image", id: "im-1" },
        },
        {
          type: "message",
          source: { type: "user", userId: "U-a" },
          replyToken: "r",
          message: { type: "sticker", id: "st-1" },
        },
      ]),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("caches reply token on receipt and uses it on next send", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter.onInbound(async () => undefined);
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "rtok-inbound",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ]),
    );
    await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hello back",
    });
    expect(client.replyCalls).toHaveLength(1);
    expect(client.replyCalls[0]?.token).toBe("rtok-inbound");
  });

  it("EC-H: onInbound replaces previous handler", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    adapter.onInbound(a);
    adapter.onInbound(b);
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ]),
    );
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("handler throw isolated (no rethrow)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    adapter.onInbound(async () => {
      throw new Error("boom");
    });
    await expect(
      adapter.dispatchWebhookBody(
        makeEnv([
          {
            type: "message",
            source: { type: "user", userId: "U-a" },
            replyToken: "r",
            message: { type: "text", id: "m-1", text: "hi" },
          },
        ]),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("LineAdapter mention guard (D409)", () => {
  it("DM: always dispatches even when bot not mentioned", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: true,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });

  it("Group + no mention + requireMention=true → ignore", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: true,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi team" },
        },
      ],
    });
    expect(received).toHaveLength(0);
  });

  it("Group + bot in mentionees → dispatch", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: true,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: {
            type: "text",
            id: "m-1",
            text: "@bot hi",
            mentionees: [{ index: 0, length: 4, userId: "U-bot" }],
          },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });

  it("Group + requireMention=false → dispatch even without mention", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: false,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi team" },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });

  it("Group + botUserId unset → guard disabled (dispatches all)", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      requireMention: true,
      // no botUserId
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi team" },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });
});

/**
 * `connect()` and `disconnect()` had zero coverage. Every test in this file
 * reaches past them via `installMockClient`, which writes `connected` directly,
 * so the real lifecycle was never invoked: deleting `this.replyCache.clear()`
 * from `disconnect()` left a reconnected adapter replaying an expired reply
 * token — a LINE 400 on the first message after every restart — with the suite
 * green.
 */
describe("LineAdapter lifecycle", () => {
  it("connect() builds a client and reports success", async () => {
    // Injected: connect() now validates the token against LINE, so without a
    // seam this "unit" test would need the network and a live credential.
    const client = makeMockClient();
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      __clientFactory: () => client,
    });
    expect(await adapter.connect()).toBe(true);
    await adapter.disconnect();
  });

  it("connect() reports failure when LINE rejects the access token", async () => {
    // Building a LINE client performs no I/O whatsoever, so connect() used to
    // answer true for any string and the failure surfaced at the first send —
    // as a 401 that reads like a send bug rather than a bad token. Same gap
    // MatrixAdapter had; found by writing the live suite for this package.
    const client = makeMockClient();
    client.failBotInfoWith = Object.assign(new Error("Invalid access token"), {
      statusCode: 401,
    });
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "bad",
      __clientFactory: () => client,
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await adapter.connect()).toBe(false);
    stderr.mockRestore();
  });

  it("connect() is idempotent — a second call does not rebuild the client", async () => {
    const injected = makeMockClient();
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      __clientFactory: () => injected,
    });
    await adapter.connect();
    const client = (adapter as unknown as { client: unknown }).client;
    expect(await adapter.connect()).toBe(true);
    expect((adapter as unknown as { client: unknown }).client).toBe(client);
    await adapter.disconnect();
  });

  it("disconnect() drops the cached reply tokens", async () => {
    // A reply token is valid for ~30 seconds and single-use. Carrying one across
    // a reconnect means the first send after a restart uses a token LINE has
    // already expired, and answers 400.
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter._cacheReplyToken("U-alice", "rtok-stale");

    await adapter.disconnect();
    installMockClient(adapter, client);
    await adapter.sendMessage({ channel: { id: "U-alice", type: "dm" }, text: "after restart" });

    // Push, not reply: the stale token must not have survived.
    expect(client.replyCalls).toHaveLength(0);
    expect(client.pushCalls).toHaveLength(1);
  });

  it("disconnect() clears the inbound handler", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });

    await adapter.disconnect();
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ],
    });

    expect(received).toHaveLength(0);
  });

  it("disconnect() is idempotent on a never-connected adapter", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    await adapter.disconnect();
    await adapter.disconnect();
    expect(adapter.platform).toBe("line");
  });

  it("sendMessage before connect() reports not_connected instead of throwing", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const r = await adapter.sendMessage({ channel: { id: "U-alice", type: "dm" }, text: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not_connected");
  });
});

describe("LineAdapter — the format the caller declared", () => {
  /**
   * This is the platform where the silence was OBSERVED. An agent answered
   * `**Bom Sucesso (MG)**` on 2026-08-30 and the person read literal asterisks, because a LINE
   * text message carries `{ type: "text", text }` and nothing else — and the adapter dropped
   * the declared intent without a word.
   *
   * The fix is not formatting the text; that is the presenter's job (B-019). It is refusing to
   * discard the field in silence.
   */
  it("warns once that a LINE text message cannot carry a declared format", async () => {
    const client = makeMockClient();
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      __clientFactory: () => client,
    });
    await adapter.connect();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await adapter.sendMessage({ channel: { id: "U1", type: "dm" }, text: "a", format: "markdown" });
    await adapter.sendMessage({ channel: { id: "U1", type: "dm" }, text: "b", format: "markdown" });

    const warned = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("cannot carry it"));
    expect(warned, "warned per message instead of once").toHaveLength(1);
    stderr.mockRestore();
    await adapter.disconnect();
  });
});
