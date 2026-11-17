import {
  BasePlatformAdapter,
  GatewayRunner,
  type MessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { AgentTurnError, createAgentHandler, type TurnAgent } from "../src/index.js";

class FakeAdapter extends BasePlatformAdapter {
  readonly platform = "telegram" as const;
  sent: OutboundMessage[] = [];
  reacts: Array<[string, string, string]> = [];
  typing = 0;
  reactThrows = false;
  private handler?: (event: MessageEvent) => Promise<void>;
  override async connect(): Promise<boolean> {
    return true;
  }
  override async disconnect(): Promise<void> {}
  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    this.sent.push(out);
    return { ok: true, messageId: `m${this.sent.length}` };
  }
  override onInbound(handler: (event: MessageEvent) => Promise<void>): () => void {
    this.handler = handler;
    return () => {};
  }
  override async react(c: string, m: string, e: string): Promise<SendResult> {
    this.reacts.push([c, m, e]);
    if (this.reactThrows) throw new Error("nope");
    return { ok: true };
  }
  override async startTyping(): Promise<void> {
    this.typing += 1;
  }
  override async deliver(e: MessageEvent): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, e);
  }
  async emit(e: MessageEvent): Promise<void> {
    await this.handler?.(e);
  }
}

const EVENT = {
  id: "tg-1",
  platform: "telegram",
  sender: { id: "100" },
  channel: { id: "1", type: "dm" },
  text: "hi",
  receivedAt: 0,
  telegram: { chatId: 1, messageId: 1, raw: {} },
} as unknown as MessageEvent;

function agentOf(frames: unknown[], status = "finished", code?: string): TurnAgent {
  return {
    async send() {
      return {
        stream: () =>
          (async function* () {
            for (const f of frames) yield f as { type: string };
          })(),
        wait: async () => ({ status, ...(code ? { error: { code } } : {}) }),
      };
    },
  };
}

const text = (t: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text: t }] },
});

async function setup(
  make: () => Promise<TurnAgent>,
  extra: Record<string, unknown> = {},
  adapter = new FakeAdapter(),
) {
  const counts = { released: 0 };
  const errors: Error[] = [];
  const runner: GatewayRunner = new GatewayRunner({
    adapters: [adapter],
    handler: createAgentHandler({
      agentFor: async () => {
        const agent = await make();
        return { agent, release: () => void counts.released++ };
      },
      adapter: (p) => runner.adapter(p),
      ...extra,
    }),
    hooks: [
      { name: "e", on_error: async (c: { error: Error }) => void errors.push(c.error) },
    ] as never,
  });
  await runner.start();
  await adapter.emit(EVENT);
  await runner.stop();
  return { adapter, counts, errors };
}

const texts = (a: FakeAdapter) => a.sent.map((m) => m.text);

describe("createAgentHandler", () => {
  it("sends exactly one reply with the streamed text", async () => {
    const { adapter, counts } = await setup(async () => agentOf([text("Hello "), text("world")]));
    expect(texts(adapter)).toEqual(["Hello world"]);
    expect(counts.released).toBe(1);
    expect(adapter.typing).toBeGreaterThanOrEqual(0);
  });

  it("replies noAnswerText for an empty answer", async () => {
    const { adapter } = await setup(async () => agentOf([]));
    expect(texts(adapter)).toEqual(["I could not come up with an answer to that."]);
  });

  it("replies errorText once and rethrows AgentTurnError to on_error", async () => {
    const { adapter, counts, errors } = await setup(
      async () => agentOf([text("partial"), { type: "status", status: "ERROR", message: "x" }]),
      { errorText: "oops" },
    );
    expect(texts(adapter)).toEqual(["oops"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AgentTurnError);
    expect((errors[0] as AgentTurnError).code).toBe("AGENT_ERROR");
    expect((errors[0] as AgentTurnError).platform).toBe("telegram");
    expect(counts.released).toBe(1);
  });

  it("agentFor rejecting still sends one error reply and rethrows", async () => {
    const adapter = new FakeAdapter();
    const errors: Error[] = [];
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: createAgentHandler({
        agentFor: async () => {
          throw new Error("no agent");
        },
        errorText: "oops",
      }),
      hooks: [
        { name: "e", on_error: async (c: { error: Error }) => void errors.push(c.error) },
      ] as never,
    });
    await runner.start();
    await adapter.emit(EVENT);
    await runner.stop();
    expect(texts(adapter)).toEqual(["oops"]);
    expect(errors[0]).toBeInstanceOf(AgentTurnError);
  });

  it("reacts once with the inbound id, survives a throwing react, starts no typing itself", async () => {
    const adapter = new FakeAdapter();
    adapter.reactThrows = true;
    await setup(async () => agentOf([text("ok")]), { ackEmoji: "eyes" }, adapter);
    expect(adapter.reacts).toEqual([["1", "tg-1", "eyes"]]);
    expect(texts(adapter)).toEqual(["ok"]);
  });

  it("never shows a secret split across frames", async () => {
    const { adapter } = await setup(async () => agentOf([text("key tok-"), text("123 end")]), {
      secrets: ["tok-123"],
    });
    expect(adapter.sent.map((m) => m.text).join("|")).not.toContain("tok-");
    expect(texts(adapter)).toHaveLength(1);
  });

  it("releases once when send throws", async () => {
    const { adapter, counts, errors } = await setup(async () => ({
      send: async () => {
        throw new Error("boom");
      },
    }));
    expect(counts.released).toBe(1);
    expect(texts(adapter)).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});
