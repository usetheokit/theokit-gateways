/**
 * `GatewayRunner` over `TwitchAdapter`, offline (B-363 FR-007, AC-051).
 *
 * One `channel.chat.message` notification goes through the runner, the handler replies through
 * `ctx.reply`, and exactly one Send Chat Message carries the reply while `post_outbound` fires once
 * with platform `twitch`. A send written straight to the adapter reaches Helix and leaves
 * `post_outbound` at zero. EventSub is a scripted socket and Helix a scripted `fetch`.
 */

import { type GatewayHook, GatewayRunner, type PlatformName } from "@theokit/gateway";
import { TwitchAdapter, type TwitchSocket } from "@theokit/gateway-twitch";
import { afterEach, describe, expect, it } from "vitest";

const BOT = "1001";
const BROADCASTER = "2002";

/** An EventSub socket that welcomes as soon as it opens and lets the test push a chat message. */
class ScriptedEventSub implements TwitchSocket {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    queueMicrotask(() =>
      this.frame(
        "session_welcome",
        { session: { id: "s1", keepalive_timeout_seconds: 600 } },
        "w1",
      ),
    );
  }

  send(): void {}

  close(): void {
    this.onclose?.();
  }

  chat(text: string): void {
    this.frame(
      "notification",
      {
        subscription: { type: "channel.chat.message" },
        event: {
          broadcaster_user_id: BROADCASTER,
          chatter_user_id: "3003",
          chatter_user_login: "viewer",
          message_id: "chat-1",
          message: { text },
        },
      },
      "n1",
      "channel.chat.message",
    );
  }

  private frame(type: string, payload: unknown, id: string, subscription?: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        metadata: {
          message_id: id,
          message_type: type,
          ...(subscription === undefined ? {} : { subscription_type: subscription }),
        },
        payload,
      }),
    });
  }
}

/** Helix that accepts the token, every subscription and every message. */
class ScriptedHelix {
  readonly sent: string[] = [];

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname;
    if (path === "/oauth2/validate") {
      return Response.json({
        client_id: "c",
        user_id: BOT,
        scopes: ["user:read:chat", "user:write:chat"],
      });
    }
    if (path === "/helix/eventsub/subscriptions") return new Response(null, { status: 202 });
    this.sent.push(String((JSON.parse(String(init?.body)) as { message: string }).message));
    return Response.json({ data: [{ message_id: `m${this.sent.length}`, is_sent: true }] });
  };
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

function makeAdapter(helix: ScriptedHelix, sockets: ScriptedEventSub[]): TwitchAdapter {
  return new TwitchAdapter({
    accessToken: "token",
    botUserId: BOT,
    broadcasterUserIds: [BROADCASTER],
    fetch: helix.fetch,
    socketFactory: () => {
      const socket = new ScriptedEventSub();
      sockets.push(socket);
      return socket;
    },
  });
}

const running: GatewayRunner[] = [];

afterEach(async () => {
  for (const runner of running.splice(0)) await runner.stop();
});

describe("GatewayRunner drives TwitchAdapter", () => {
  it("gives one notification one Send Chat Message and one post_outbound for twitch", async () => {
    const helix = new ScriptedHelix();
    const sockets: ScriptedEventSub[] = [];
    const { hook, platforms } = countingHook();
    let markHandled: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    const runner = new GatewayRunner({
      adapters: [makeAdapter(helix, sockets)],
      hooks: [hook],
      handler: async (_event, ctx) => {
        await ctx.reply("hello back");
        markHandled();
      },
    });
    running.push(runner);
    await runner.start();

    sockets[0]?.chat("hello");
    await handled;

    expect(helix.sent).toEqual(["hello back"]);
    expect(platforms).toEqual(["twitch"]);
  });

  it("leaves post_outbound at zero for a send written around the runner", async () => {
    const helix = new ScriptedHelix();
    const adapter = makeAdapter(helix, []);
    const { hook, platforms } = countingHook();
    const runner = new GatewayRunner({
      adapters: [adapter],
      hooks: [hook],
      handler: async () => undefined,
    });
    running.push(runner);
    await runner.start();

    const result = await adapter.sendMessage({
      channel: { id: BROADCASTER, type: "group" },
      text: "written around the runner",
    });

    expect(result.ok).toBe(true);
    expect(helix.sent).toEqual(["written around the runner"]);
    expect(platforms).toEqual([]);
  });
});
