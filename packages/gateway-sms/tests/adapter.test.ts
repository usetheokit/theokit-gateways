import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { SMSAdapter } from "../src/adapter.js";
import type { SignatureContext, SMSBackend } from "../src/backend-types.js";
import { ConfigurationError } from "../src/errors.js";
import { inboundToMessageEvent } from "../src/normalize.js";

/**
 * Test-only: replaces `createBackend()` with an injected mock. We
 * monkey-patch the adapter's private backend field via TypeScript's
 * structural typing — easier than module-level mocking.
 */
function makeAdapterWithMockBackend(mockBackend: SMSBackend): SMSAdapter {
  const adapter = new SMSAdapter({
    backend: "twilio",
    accountSid: "ACtest",
    authToken: "tok-test", // EC-1: required
    fromNumber: "+14155550100",
    publicUrl: "http://localhost:3000",
  });
  // Replace the backend with our mock.
  (adapter as unknown as { backend: SMSBackend }).backend = mockBackend;
  return adapter;
}

function makeMockBackend(): SMSBackend & {
  connectCalls: number;
  disconnectCalls: number;
  sentMessages: Array<{ to: string; body: string }>;
} {
  const sent: Array<{ to: string; body: string }> = [];
  const state = { connect: 0, disconnect: 0 };
  return {
    kind: "twilio" as const,
    connectCalls: 0,
    disconnectCalls: 0,
    sentMessages: sent,
    async connect() {
      state.connect += 1;
      (this as unknown as { connectCalls: number }).connectCalls = state.connect;
      return true;
    },
    async disconnect() {
      state.disconnect += 1;
      (this as unknown as { disconnectCalls: number }).disconnectCalls = state.disconnect;
    },
    verifySignature(_ctx: SignatureContext) {
      return true;
    },
    parseInbound(_ctx: SignatureContext) {
      return {
        from: "+5511999999999",
        to: "+14155550100",
        body: "hi from user",
        messageId: "SMmock",
        receivedAt: Date.now(),
        raw: {},
      };
    },
    async sendMessage(to: string, body: string) {
      sent.push({ to, body });
      return { ok: true, messageId: `SM${sent.length}` };
    },
  } as SMSBackend & {
    connectCalls: number;
    disconnectCalls: number;
    sentMessages: Array<{ to: string; body: string }>;
  };
}

describe("SMSAdapter constructor (EC-1)", () => {
  // All three backends raise the SAME `signing_secret_required` code, so unlike the sibling adapters
  // the code cannot say WHICH one refused — the message names the backend and is the only thing that
  // does. Without this, a constructor that read the wrong backend's secret, or named the wrong
  // backend in its diagnostic, passed all three cases below.
  const refusalFor = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      expect(err, "threw something that is not a ConfigurationError").toBeInstanceOf(
        ConfigurationError,
      );
      expect((err as ConfigurationError).code).toBe("signing_secret_required");
      return (err as Error).message;
    }
    throw new Error("expected a ConfigurationError, nothing was thrown");
  };

  it("throws when twilio authToken is empty", () => {
    expect(
      refusalFor(
        () =>
          new SMSAdapter({
            backend: "twilio",
            accountSid: "AC",
            authToken: "",
            fromNumber: "+14155550100",
            publicUrl: "http://localhost",
          }),
      ),
    ).toContain('backend="twilio"');
  });

  it("throws when plivo authToken is empty", () => {
    expect(
      refusalFor(
        () =>
          new SMSAdapter({
            backend: "plivo",
            authId: "AI",
            authToken: "",
            fromNumber: "+14155550100",
            publicUrl: "http://localhost",
          }),
      ),
    ).toContain('backend="plivo"');
  });

  it("throws when vonage signatureSecret is empty", () => {
    expect(
      refusalFor(
        () =>
          new SMSAdapter({
            backend: "vonage",
            apiKey: "k",
            apiSecret: "s",
            signatureSecret: "",
            fromNumber: "+14155550100",
            publicUrl: "http://localhost",
          }),
      ),
    ).toContain('backend="vonage"');
  });

  it("ConfigurationError carries code=signing_secret_required", () => {
    try {
      new SMSAdapter({
        backend: "twilio",
        accountSid: "AC",
        authToken: "",
        fromNumber: "+14155550100",
        publicUrl: "http://localhost",
      });
    } catch (err) {
      expect((err as ConfigurationError).code).toBe("signing_secret_required");
      return;
    }
    throw new Error("did not throw");
  });
});

describe("SMSAdapter lifecycle", () => {
  it("connect() idempotent", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    expect(await adapter.connect()).toBe(true);
    expect(await adapter.connect()).toBe(true);
    expect(mock.connectCalls).toBe(1);
  });

  it("disconnect() idempotent", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    await adapter.disconnect();
    await adapter.disconnect();
    expect(mock.disconnectCalls).toBe(1);
  });

  it("disconnect() before connect is safe", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.disconnect();
    expect(mock.disconnectCalls).toBe(0);
  });
});

describe("SMSAdapter.sendMessage", () => {
  it("rejects empty text without calling backend", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    const result = await adapter.sendMessage({
      channel: { id: "+5511999999999", type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(mock.sentMessages).toHaveLength(0);
  });

  it("returns invalid_phone_number for malformed to", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    const result = await adapter.sendMessage({
      channel: { id: "not-a-phone", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_phone_number");
    expect(mock.sentMessages).toHaveLength(0);
  });

  it("normalizes E.164 before sending to backend", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    await adapter.sendMessage({
      channel: { id: "+5511999999999", type: "dm" },
      text: "hi",
    });
    expect(mock.sentMessages[0]?.to).toBe("+5511999999999");
  });

  it("splits long text into multiple backend calls", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    const long = "x".repeat(3000);
    await adapter.sendMessage({
      channel: { id: "+14155550100", type: "dm" },
      text: long,
    });
    expect(mock.sentMessages.length).toBeGreaterThan(1);
    for (const m of mock.sentMessages) {
      expect(m.body).toMatch(/^\(\d+\/\d+\) /);
    }
  });

  it("returns partial_send_failure when nth part fails", async () => {
    const mock = makeMockBackend();
    let counter = 0;
    mock.sendMessage = async (to: string, body: string) => {
      counter += 1;
      if (counter === 2) {
        return { ok: false, error: { code: "rate_limit", message: "boom" } };
      }
      mock.sentMessages.push({ to, body });
      return { ok: true, messageId: `SM${counter}` };
    };
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    const result = await adapter.sendMessage({
      channel: { id: "+14155550100", type: "dm" },
      text: "x".repeat(3000),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("rate_limit");
  });
});

describe("SMSAdapter.onInbound (EC-H)", () => {
  it("dispatches inbound event to registered handler", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    const event = adapter.buildEventFromCtx({ headers: {}, rawBody: "", url: "" });
    await adapter.dispatchEvent(event);
    expect(received).toHaveLength(1);
    expect(received[0]?.platform).toBe("sms");
  });

  it("EC-H: second onInbound replaces (does not stack) previous handler", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    adapter.onInbound(a);
    adapter.onInbound(b);
    const event = adapter.buildEventFromCtx({ headers: {}, rawBody: "", url: "" });
    await adapter.dispatchEvent(event);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("returns no_handler when nothing registered", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    const event = adapter.buildEventFromCtx({ headers: {}, rawBody: "", url: "" });
    const out = await adapter.dispatchEvent(event);
    expect(out).toBe("no_handler");
  });

  it("isolates handler exceptions (no rethrow)", async () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    await adapter.connect();
    adapter.onInbound(async () => {
      throw new Error("handler boom");
    });
    const event = adapter.buildEventFromCtx({ headers: {}, rawBody: "", url: "" });
    await expect(adapter.dispatchEvent(event)).resolves.toBe("ok");
  });
});

describe("SMSAdapter signature verification routing", () => {
  it("verifySignature delegates to backend", () => {
    const mock = makeMockBackend();
    mock.verifySignature = () => false;
    const adapter = makeAdapterWithMockBackend(mock);
    expect(adapter.verifySignature({ headers: {}, rawBody: "x", url: "" })).toBe(false);
  });

  it("getBackendKind returns the chosen backend", () => {
    const mock = makeMockBackend();
    const adapter = makeAdapterWithMockBackend(mock);
    expect(adapter.getBackendKind()).toBe("twilio");
  });
});

describe("inboundToMessageEvent (normalize)", () => {
  it("populates SMS variant with all fields", () => {
    const event = inboundToMessageEvent(
      {
        from: "+5511999999999",
        to: "+14155550100",
        body: "hello",
        messageId: "SMx",
        receivedAt: 12345,
        raw: { foo: "bar" },
      },
      "twilio",
    );
    expect(event.platform).toBe("sms");
    expect(event.sender.id).toBe("+5511999999999");
    expect(event.channel.id).toBe("+5511999999999");
    expect(event.channel.type).toBe("dm");
    expect(event.text).toBe("hello");
    expect(event.sms.backend).toBe("twilio");
    expect(event.sms.from).toBe("+5511999999999");
    expect(event.sms.to).toBe("+14155550100");
    expect(event.sms.messageId).toBe("SMx");
  });
});

describe("SMSAdapter — a format the medium cannot carry", () => {
  /**
   * SMS is plain text by definition: there is no flag, no markup, no alternative part. So the
   * honest handling of `format: "markdown"` is not to pretend — it is to say once that the
   * caller's declared intent is being dropped.
   *
   * `rules/error-handling.md` is the reason. Silently discarding a field the contract declares
   * is the swallowed-error shape: nothing fails, and the caller learns their formatting never
   * arrived from a user, weeks later.
   */
  it("warns once that the medium cannot carry a declared format", async () => {
    const adapter = makeAdapterWithMockBackend({
      sendMessage: async () => ({ ok: true as const, messageId: "sid-1" }),
      verifySignature: () => true,
      parseInbound: () => undefined,
    } as unknown as SMSBackend);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await adapter.sendMessage({
      channel: { id: "+14155550199", type: "dm" },
      text: "**bold**",
      format: "markdown",
    });
    await adapter.sendMessage({
      channel: { id: "+14155550199", type: "dm" },
      text: "**more**",
      format: "markdown",
    });

    const warnings = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("cannot carry"));
    expect(warnings, "warned per message instead of once").toHaveLength(1);
    stderr.mockRestore();
  });

  it("says nothing when no format is declared", async () => {
    const adapter = makeAdapterWithMockBackend({
      sendMessage: async () => ({ ok: true as const, messageId: "sid-1" }),
      verifySignature: () => true,
      parseInbound: () => undefined,
    } as unknown as SMSBackend);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await adapter.sendMessage({ channel: { id: "+14155550199", type: "dm" }, text: "plain" });

    const warnings = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("cannot carry"));
    expect(warnings).toHaveLength(0);
    stderr.mockRestore();
  });
});
