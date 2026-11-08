import type { MessageEvent as GatewayMessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { splitForZaloPersonal, ZaloPersonalAdapter } from "../src/index.js";
import { CREDENTIALS, FakeZaloApi, text } from "./fakes.js";

function make(api = new FakeZaloApi()) {
  const adapter = new ZaloPersonalAdapter({ credentials: CREDENTIALS, login: async () => api });
  return { api, adapter };
}

async function inbound(adapter: ZaloPersonalAdapter): Promise<GatewayMessageEvent[]> {
  const events: GatewayMessageEvent[] = [];
  adapter.onInbound(async (e) => {
    events.push(e);
  });
  return events;
}

describe("ZaloPersonalAdapter", () => {
  it("names the platform and rejects credentials without an imei", () => {
    expect(make().adapter.platform).toBe("zalo_personal");
    expect(
      () => new ZaloPersonalAdapter({ credentials: { cookie: [], imei: "", userAgent: "u" } }),
    ).toThrow(/imei/);
  });

  it("connects by logging in and starting the listener, once", async () => {
    const { api, adapter } = make();
    expect(await adapter.connect()).toBe(true);
    expect(await adapter.connect()).toBe(true);
    expect(api.started).toBe(1);
  });

  it("answers false, not a throw, when the login is refused or zca-js is missing", async () => {
    const refused = new ZaloPersonalAdapter({
      credentials: CREDENTIALS,
      login: async () => {
        throw new Error("login refused");
      },
    });
    expect(await refused.connect()).toBe(false);
    expect(await new ZaloPersonalAdapter({ credentials: CREDENTIALS }).connect()).toBe(false);
  });

  it("does not report connected when disconnect() overtakes the login", async () => {
    let release: () => void = () => undefined;
    const api = new FakeZaloApi();
    const adapter = new ZaloPersonalAdapter({
      credentials: CREDENTIALS,
      login: () => new Promise((resolve) => (release = () => resolve(api))),
    });
    const pending = adapter.connect();
    await adapter.disconnect();
    release();
    expect(await pending).toBe(false);
    expect(api.started).toBe(0);
  });

  it("turns a direct message into an event and skips own, repeated and non-text messages", async () => {
    const { api, adapter } = make();
    const events = await inbound(adapter);
    await adapter.connect();
    api.emit(text("hello"));
    api.emit(text("hello"));
    api.emit(text("mine", { isSelf: true, msgId: "m2" }));
    api.emit(text({ href: "x" }, { msgId: "m3" }));
    api.emit(text("in a group", { type: 1, threadId: "g1", msgId: "m4" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events.map((e) => [e.id, e.text, e.channel])).toEqual([
      ["m1", "hello", { id: "peer-1", type: "dm" }],
      ["m4", "in a group", { id: "g1", type: "group" }],
    ]);
    expect(events[0]).toMatchObject({
      platform: "zalo_personal",
      sender: { id: "peer-1", username: "Linh" },
      zalo_personal: { threadType: "user", senderUid: "peer-1" },
    });
  });

  it("deliver() runs the handler and reports no_handler without one", async () => {
    const { adapter } = make();
    const event = { id: "x" } as GatewayMessageEvent;
    expect(await adapter.deliver(event)).toBe("no_handler");
    const events = await inbound(adapter);
    expect(await adapter.deliver(event)).toBe("ok");
    expect(events).toEqual([event]);
  });

  it("sends text to the thread with the right thread type, stripping markdown", async () => {
    const { api, adapter } = make();
    await adapter.connect();
    const dm = await adapter.sendMessage({
      channel: { id: "peer-1", type: "dm" },
      text: "**hi**",
      format: "markdown",
    });
    const group = await adapter.sendMessage({ channel: { id: "g1", type: "group" }, text: "yo" });
    expect(dm).toEqual({ ok: true, messageId: "9001" });
    expect(group.ok).toBe(true);
    expect(api.sent).toEqual([
      { msg: "hi", threadId: "peer-1", type: 0 },
      { msg: "yo", threadId: "g1", type: 1 },
    ]);
  });

  it("splits a long reply in order and answers the last id", async () => {
    const { api, adapter } = make();
    await adapter.connect();
    const result = await adapter.sendMessage({
      channel: { id: "p", type: "dm" },
      text: "a".repeat(4500),
    });
    expect(api.sent.map((s) => s.msg.length)).toEqual([2000, 2000, 500]);
    expect(result).toEqual({ ok: true, messageId: "9003" });
    expect(splitForZaloPersonal("")).toEqual([]);
  });

  it("refuses without a call: attachments, empty text, not connected, empty thread", async () => {
    const { api, adapter } = make();
    const base = { channel: { id: "p", type: "dm" as const } };
    expect((await adapter.sendMessage({ ...base, text: "x" })).error?.code).toBe("not_connected");
    await adapter.connect();
    expect((await adapter.sendMessage({ ...base, text: "" })).error?.code).toBe("empty_text");
    expect(
      (await adapter.sendMessage({ channel: { id: "", type: "dm" }, text: "x" })).error?.code,
    ).toBe("invalid_channel");
    const withImage = await adapter.sendMessage({
      ...base,
      text: "x",
      attachments: [{ kind: "image", data: new Uint8Array([1]), mimeType: "image/png" }],
    } as never);
    expect(withImage.error?.code).toBe("attachments_unsupported");
    expect(api.sent).toEqual([]);
  });

  it("reports a failed send as a result, and a closed listener as not connected", async () => {
    const { api, adapter } = make();
    await adapter.connect();
    api.failSend = new Error("rate limited");
    const failed = await adapter.sendMessage({ channel: { id: "p", type: "dm" }, text: "x" });
    expect(failed).toEqual({
      ok: false,
      error: { code: "zalo_send_failed", message: "rate limited" },
    });
    api.close(3000, "another session");
    expect(
      (await adapter.sendMessage({ channel: { id: "p", type: "dm" }, text: "x" })).error?.code,
    ).toBe("not_connected");
  });

  it("stops the listener on disconnect", async () => {
    const { api, adapter } = make();
    await adapter.connect();
    await adapter.disconnect();
    expect(api.stopped).toBe(1);
  });
});
