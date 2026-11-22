/**
 * Tests for `BasePlatformAdapter` contract (T1.2, ADR D172 + EC-H).
 */

import { describe, expect, it } from "vitest";
import type { OutboundMessage } from "../../src/adapter/base.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "./mock-adapter.js";

function ev(platform: "telegram" = "telegram"): MessageEvent {
  return {
    id: "1",
    platform,
    sender: { id: "u" },
    channel: { id: "c", type: "dm" },
    text: "hi",
    receivedAt: 0,
    telegram: { chatId: 1, messageId: 1, raw: {} },
  };
}

describe("BasePlatformAdapter (T1.2)", () => {
  it("connect is idempotent", async () => {
    const a = new MockAdapter();
    expect(await a.connect()).toBe(true);
    expect(await a.connect()).toBe(true);
    expect(a.connected).toBe(true);
  });

  it("send returns SendResult object on success", async () => {
    const a = new MockAdapter();
    const r = await a.sendMessage({ channel: { id: "c", type: "dm" }, text: "hi" });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBeDefined();
  });

  it("send with empty text returns error, does not throw", async () => {
    const a = new MockAdapter();
    const r = await a.sendMessage({ channel: { id: "c", type: "dm" }, text: "" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
  });

  it("onInbound subscribe + unsubscribe stops handler", async () => {
    const a = new MockAdapter();
    let count = 0;
    const unsub = a.onInbound(async () => {
      count += 1;
    });
    await a.emit(ev());
    expect(count).toBe(1);
    unsub();
    await a.emit(ev());
    expect(count).toBe(1);
  });

  it("disconnect is idempotent (safe on never-connected)", async () => {
    const a = new MockAdapter();
    await a.disconnect();
    await a.disconnect();
    expect(a.disconnectCount).toBe(2);
    expect(a.connected).toBe(false);
  });

  it("EC-H: onInbound second call REPLACES previous handler (not stacks)", async () => {
    const a = new MockAdapter();
    const calls: string[] = [];
    a.onInbound(async () => {
      calls.push("first");
    });
    a.onInbound(async () => {
      calls.push("second");
    });
    await a.emit(ev());
    expect(calls).toEqual(["second"]);
  });

  it("react resolves react_unsupported by default, without throwing", async () => {
    const a = new MockAdapter();
    const r = await a.react("c", "1", "👀");
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("react_unsupported");
  });
});

describe("refuseAttachments", () => {
  class Probe extends MockAdapter {
    constructor(override readonly supportsAttachments: boolean) {
      super();
    }
    check(attachments: unknown) {
      return this.refuseAttachments({
        channel: { id: "c" },
        text: "hi",
        attachments,
      } as unknown as OutboundMessage);
    }
  }
  const one = [{ kind: "image", data: new Uint8Array(1), mimeType: "image/png" }];

  it("refuses attachments when unsupported, passes absent, null and empty", () => {
    const a = new Probe(false);
    expect(a.check(one)).toEqual({
      ok: false,
      error: {
        code: "attachments_unsupported",
        message: "telegram adapter cannot send attachments",
      },
    });
    expect(a.check(undefined)).toBeUndefined();
    expect(a.check(null)).toBeUndefined();
    expect(a.check([])).toBeUndefined();
  });

  it("refuses a non-array value from a JavaScript caller", () => {
    expect(new Probe(false).check({})).toMatchObject({
      error: { code: "attachments_unsupported" },
    });
  });

  it("passes when attachments are supported", () => {
    expect(new Probe(true).check(one)).toBeUndefined();
  });

  it("is exported from the package entry", async () => {
    const mod = await import("../../src/index.js");
    expect(
      mod.refuseUnsupportedAttachments(new Probe(false), {
        channel: { id: "c" },
        text: "x",
        attachments: one,
      } as unknown as OutboundMessage)?.ok,
    ).toBe(false);
  });
});
