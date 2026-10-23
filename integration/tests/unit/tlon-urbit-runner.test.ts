/**
 * `GatewayRunner` over `TlonUrbitAdapter`, offline (B-362 FR-007, AC-041).
 *
 * One DM essay goes through the runner, the handler replies through `ctx.reply`, and exactly one
 * `chat-dm-action` poke carries the reply while `post_outbound` fires once with platform
 * `tlon_urbit`. A poke written straight to the adapter reaches the ship and leaves `post_outbound`
 * at zero. The ship is a scripted `fetch`: `/~/login`, the channel `PUT`s and one event stream.
 */

import { type GatewayHook, GatewayRunner, type PlatformName } from "@theokit/gateway";
import { TlonUrbitAdapter } from "@theokit/gateway-tlon-urbit";
import { afterEach, describe, expect, it } from "vitest";

const encoder = new TextEncoder();

/** A ship that acks every subscription and poke and lets the test push one fact. */
class ScriptedShip {
  readonly pokes: Array<{
    mark: string;
    json: { diff?: { delta?: { add?: { memo?: { content?: unknown } } } } };
  }> = [];
  private stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  private readonly queued: string[] = [];
  private eventId = 1;
  private subscription = 0;

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (new URL(input).pathname === "/~/login") {
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "urbauth-~bot=0v1; Path=/" },
      });
    }
    if ((init?.method ?? "GET") === "PUT") return this.put(String(init?.body));
    return this.open(init?.signal);
  };

  private put(body: string): Response {
    for (const action of JSON.parse(body) as Array<Record<string, unknown>>) {
      if (action.action === "subscribe") {
        this.subscription = Number(action.id);
        this.frame({ id: action.id, response: "subscribe", ok: "ok" });
      }
      if (action.action === "poke") {
        this.pokes.push(action as never);
        this.frame({ id: action.id, response: "poke", ok: "ok" });
      }
    }
    return new Response(null, { status: 204 });
  }

  private open(signal: AbortSignal | null | undefined): Response {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.stream = controller;
        for (const text of this.queued.splice(0)) controller.enqueue(encoder.encode(text));
        signal?.addEventListener("abort", () => controller.error(signal.reason));
      },
    });
    return new Response(body, { status: 200 });
  }

  essay(from: string, id: string, text: string): void {
    this.frame({
      id: this.subscription,
      response: "diff",
      json: {
        whom: from,
        id,
        response: {
          add: { essay: { author: from, sent: Date.now(), content: [{ inline: [text] }] } },
        },
      },
    });
  }

  /** The texts of the chat-dm-action pokes, in order. */
  sent(): unknown[] {
    return this.pokes
      .filter((poke) => poke.mark === "chat-dm-action")
      .map((poke) => {
        const content = poke.json.diff?.delta?.add?.memo?.content as
          | Array<{ inline: string[] }>
          | undefined;
        return content?.[0]?.inline[0];
      });
  }

  private frame(payload: unknown): void {
    const text = `id: ${this.eventId}\ndata: ${JSON.stringify(payload)}\n\n`;
    this.eventId += 1;
    if (this.stream === undefined) this.queued.push(text);
    else this.stream.enqueue(encoder.encode(text));
  }
}

function countingHook(): { hook: GatewayHook; platforms: PlatformName[] } {
  const platforms: PlatformName[] = [];
  return {
    platforms,
    hook: {
      name: "count-post-outbound",
      post_outbound(ctx) {
        platforms.push(ctx.event.platform);
      },
    },
  };
}

function makeAdapter(ship: ScriptedShip): TlonUrbitAdapter {
  return new TlonUrbitAdapter({
    shipUrl: "https://ship.invalid",
    ship: "~bot",
    code: "lidlut-tabwed-pillex-ridrup",
    fetch: ship.fetch,
  });
}

const running: GatewayRunner[] = [];

afterEach(async () => {
  for (const runner of running.splice(0)) await runner.stop();
});

describe("GatewayRunner drives TlonUrbitAdapter", () => {
  it("gives one essay one chat-dm-action poke and one post_outbound for tlon_urbit", async () => {
    const ship = new ScriptedShip();
    const { hook, platforms } = countingHook();
    let markHandled: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    const runner = new GatewayRunner({
      adapters: [makeAdapter(ship)],
      hooks: [hook],
      handler: async (_event, ctx) => {
        await ctx.reply("hello back");
        markHandled();
      },
    });
    running.push(runner);
    await runner.start();

    ship.essay("~zod", "~zod/1", "hello");
    await handled;

    expect(ship.sent()).toEqual(["hello back"]);
    expect(platforms).toEqual(["tlon_urbit"]);
  });

  it("leaves post_outbound at zero for a poke written around the runner", async () => {
    const ship = new ScriptedShip();
    const adapter = makeAdapter(ship);
    const { hook, platforms } = countingHook();
    const runner = new GatewayRunner({
      adapters: [adapter],
      hooks: [hook],
      handler: async () => undefined,
    });
    running.push(runner);
    await runner.start();

    const result = await adapter.sendMessage({
      channel: { id: "~zod", type: "dm" },
      text: "written around the runner",
    });

    expect(result.ok).toBe(true);
    expect(ship.sent()).toEqual(["written around the runner"]);
    expect(platforms).toEqual([]);
  });
});
