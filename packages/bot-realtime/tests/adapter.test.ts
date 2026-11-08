import type { MessageEvent as GatewayMessageEvent, OutboundMessage } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import {
  RealtimeBotAdapter,
  type RealtimeBotOptions,
  type RealtimeSocket,
  refuseAttachments,
  splitText,
} from "../src/index.js";

type Listener = (event: never) => void;

class FakeSocket implements RealtimeSocket {
  closed = 0;
  private readonly listeners = new Map<string, Listener>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed += 1;
  }
  open(): void {
    (this.listeners.get("open") as () => void)();
  }
  frame(value: unknown): void {
    (this.listeners.get("message") as (e: { data: unknown }) => void)({
      data: JSON.stringify(value),
    });
  }
}

class TestAdapter extends RealtimeBotAdapter {
  readonly platform = "buzz" as const;
  constructor(opts: RealtimeBotOptions) {
    super(opts, { label: "test", name: "Test", split: (t) => splitText(t, 5) });
  }
  async sendMessage(out: OutboundMessage) {
    return refuseAttachments(out, "Test") ?? this.sendText(out);
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const posts: { url: string; body: string }[] = [];
  const adapter = new TestAdapter({
    baseUrl: "https://x.test/",
    token: "t",
    workspaceId: "w1",
    botUserId: "bot",
    reconnectDelayMs: 0,
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    fetch: (async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(init.body as string).body });
      return new Response(JSON.stringify({ id: `sent-${posts.length}` }));
    }) as unknown as typeof fetch,
  });
  return { adapter, sockets, posts };
}

const out = (over: Partial<OutboundMessage> = {}) =>
  ({ channel: { id: "c1", type: "group" }, text: "hello world", ...over }) as OutboundMessage;

describe("helpers", () => {
  it("splitText cuts by limit and returns nothing for empty text", () => {
    expect(splitText("", 5)).toEqual([]);
    expect(splitText("abcdefghij", 5)).toEqual(["abcde", "fghij"]);
  });
  it("refuseAttachments refuses only when attachments exist", () => {
    expect(refuseAttachments(out(), "T")).toBeUndefined();
    expect(refuseAttachments(out({ attachments: [] }), "T")).toBeUndefined();
    const r = refuseAttachments(out({ attachments: [{}] as never }), "T");
    expect(r).toMatchObject({ ok: false, error: { code: "attachments_unsupported" } });
  });
});

describe("RealtimeBotAdapter", () => {
  it("requires its options", () => {
    expect(() => new TestAdapter({ baseUrl: "", token: "t" } as never)).toThrow(/baseUrl/);
  });

  it("refuses to send before connecting", async () => {
    const { adapter } = setup();
    expect(await adapter.sendMessage(out())).toMatchObject({
      ok: false,
      error: { code: "not_connected" },
    });
  });

  it("connects, then posts a long text in parts and answers the last id", async () => {
    const { adapter, sockets, posts } = setup();
    const p = adapter.connect();
    sockets[0]?.open();
    expect(await p).toBe(true);
    expect(sockets[0]?.url).toBe("wss://x.test/api/realtime/ws?workspace_id=w1");
    const r = await adapter.sendMessage(out());
    expect(r).toEqual({ ok: true, messageId: "sent-3" });
    expect(posts.map((x) => x.body)).toEqual(["hello", " worl", "d"]);
    expect(posts[0]?.url).toBe("https://x.test/api/channels/c1/messages");
  });

  it("delivers inbound messages once, skipping the bot's own", async () => {
    const { adapter, sockets } = setup();
    const got: GatewayMessageEvent[] = [];
    adapter.onInbound(async (e) => {
      got.push(e);
    });
    const p = adapter.connect();
    sockets[0]?.open();
    await p;
    const msg = (id: string, author: string) => ({
      type: "message.created",
      cursor: "9",
      payload: { message: { id, channel_id: "c1", author_user_id: author, body: "hi" } },
    });
    sockets[0]?.frame(msg("m1", "u1"));
    sockets[0]?.frame(msg("m1", "u1"));
    sockets[0]?.frame(msg("m2", "bot"));
    await new Promise((r) => setTimeout(r, 0));
    expect(got.map((e) => e.id)).toEqual(["m1"]);
    expect(got[0]?.text).toBe("hi");
  });
});
