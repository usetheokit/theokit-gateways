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
  refuse = false;
  private handler?: (event: MessageEvent) => Promise<void>;
  override async connect(): Promise<boolean> {
    return true;
  }
  override async disconnect(): Promise<void> {}
  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    this.sent.push(out);
    if (this.refuse) return { ok: false, error: { code: "blocked", message: "no" } };
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
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: createAgentHandler({
      agentFor: async () => {
        const agent = await make();
        return { agent, release: () => void counts.released++ };
      },
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

  it("a refused final reply throws a delivery error and is not retried", async () => {
    const adapter = new FakeAdapter();
    adapter.refuse = true;
    const { errors, counts } = await setup(async () => agentOf([text("hello")]), {}, adapter);
    expect(texts(adapter)).toEqual(["hello"]);
    expect(errors[0]).toBeInstanceOf(AgentTurnError);
    expect((errors[0] as AgentTurnError).code).toBe("reply_refused");
    expect(counts.released).toBe(1);
  });

  it("never copies an exception's name or message into the error", async () => {
    const secretName = "prompt: my password is hunter2";
    const { errors } = await setup(async () => {
      const e = new Error("hunter2");
      e.name = secretName;
      throw e;
    });
    const err = errors[0] as AgentTurnError;
    expect(err).toBeInstanceOf(AgentTurnError);
    expect(err.code).toBe("unexpected_error");
    expect(`${err.name} ${err.message} ${err.code}`).not.toContain("hunter2");
  });

  it("reacts to a WhatsApp event with its wamid, not the gateway id", async () => {
    const reacts: Array<[string, string]> = [];
    const event = {
      ...EVENT,
      id: "wa-gateway-id",
      platform: "whatsapp",
      whatsapp: { wamid: "wamid.ABC" },
    } as unknown as MessageEvent;
    const handler = createAgentHandler({
      agentFor: async () => ({ agent: agentOf([text("ok")]), release: () => {} }),
      ackEmoji: "eyes",
    });
    const ctx = {
      event,
      reply: async () => ({ ok: true }),
      react: async (m: string, e: string) => {
        reacts.push([m, e]);
        return { ok: true };
      },
    };
    await handler(event, ctx as never);
    expect(reacts).toEqual([["wamid.ABC", "eyes"]]);
  });

  it("reacts through the adapter when the context has no react (gateway 0.20.x)", async () => {
    const adapter = new FakeAdapter();
    const handler = createAgentHandler({
      agentFor: async () => ({ agent: agentOf([text("ok")]), release: () => {} }),
      ackEmoji: "eyes",
      adapters: [adapter],
    });
    await handler(EVENT, { event: EVENT, reply: async () => ({ ok: true }) });
    expect(adapter.reacts).toEqual([["1", "1", "eyes"]]);
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
    await setup(
      async () => agentOf([text("ok")]),
      { ackEmoji: "eyes", adapters: [adapter] },
      adapter,
    );
    expect(adapter.reacts).toEqual([["1", "1", "eyes"]]);
    expect(texts(adapter)).toEqual(["ok"]);
  });

  it("ackEmoji with no ctx.react and no adapter throws a typed configuration error", async () => {
    const sent: string[] = [];
    let released = 0;
    const handler = createAgentHandler({
      agentFor: async () => ({ agent: agentOf([text("ok")]), release: () => void released++ }),
      ackEmoji: "eyes",
    });
    const ctx = {
      event: EVENT,
      reply: async (t: string) => {
        sent.push(t);
        return { ok: true };
      },
    };
    await expect(handler(EVENT, ctx as never)).rejects.toMatchObject({
      name: "AckReactionUnavailableError",
      platform: EVENT.platform,
    });
    expect(sent).toEqual([]);
    expect(released).toBe(0);
  });

  it("a ctx whose react getter throws still runs the turn without ackEmoji", async () => {
    for (const ackEmoji of [undefined]) {
      const sent: string[] = [];
      const handler = createAgentHandler({
        agentFor: async () => ({ agent: agentOf([text("ok")]), release: () => {} }),
        ...(ackEmoji ? { ackEmoji } : {}),
      });
      const ctx = {
        event: EVENT,
        reply: async (t: string) => {
          sent.push(t);
          return { ok: true };
        },
        get react(): never {
          throw new Error("no adapter");
        },
      };
      await handler(EVENT, ctx as never);
      expect(sent).toEqual(["ok"]);
    }
  });

  it("called directly, reacts through ctx only and never touches typing", async () => {
    const adapter = new FakeAdapter();
    const sent: string[] = [];
    const reacts: Array<[string, string]> = [];
    const handler = createAgentHandler({
      agentFor: async () => ({ agent: agentOf([text("ok")]), release: () => {} }),
      ackEmoji: "eyes",
    });
    const reply = async (t: string) => {
      sent.push(t);
      return { ok: true };
    };
    const touched = new Set<string>();
    const base = {
      event: EVENT,
      reply,
      react: async (m: string, e: string) => {
        reacts.push([m, e]);
        throw new Error("nope");
      },
    };
    const spy = new Proxy(base, {
      get(target, key, receiver) {
        touched.add(String(key));
        return Reflect.get(target, key, receiver);
      },
    });
    await handler(EVENT, spy);
    await expect(handler(EVENT, { event: EVENT, reply })).rejects.toThrow(/ackEmoji/); // no react
    expect([...touched].filter((k) => /typing/i.test(k))).toEqual([]);
    expect(sent).toEqual(["ok"]);
    expect(reacts).toEqual([["1", "eyes"]]);
    expect(adapter.typing).toBe(0);
  });

  it("falls back to the default text when noAnswerText or errorText is empty", async () => {
    const empty = await setup(async () => agentOf([]), { noAnswerText: "  " });
    expect(texts(empty.adapter)).toEqual(["I could not come up with an answer to that."]);
    const failed = await setup(
      async () => agentOf([{ type: "status", status: "ERROR", message: "x" }]),
      { errorText: "" },
    );
    expect(texts(failed.adapter)).toHaveLength(1);
    expect(texts(failed.adapter)[0]).not.toBe("");
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
