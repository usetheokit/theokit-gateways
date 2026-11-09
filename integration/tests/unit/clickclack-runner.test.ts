/**
 * `GatewayRunner` over `ClickClackAdapter`, offline (B-366).
 *
 * One realtime frame goes through the runner, the handler replies through `ctx.reply`, and exactly
 * one POST carries the reply while `post_outbound` fires once with platform `clickclack`. The
 * socket and `fetch` are scripted fakes.
 */

import { type GatewayHook, GatewayRunner, type PlatformName } from "@theokit/gateway";
import { ClickClackAdapter, type ClickClackSocket } from "@theokit/gateway-clickclack";
import { afterEach, describe, expect, it } from "vitest";

const running: GatewayRunner[] = [];
afterEach(async () => {
  for (const runner of running.splice(0)) await runner.stop();
});

function scripted() {
  const listeners = new Map<string, (e: never) => void>();
  const posts: { url: string; body: string }[] = [];
  const socket: ClickClackSocket = {
    addEventListener: ((type: string, l: (e: never) => void) => {
      listeners.set(type, l);
      if (type === "open") queueMicrotask(() => (l as () => void)());
    }) as ClickClackSocket["addEventListener"],
    close: () => undefined,
  };
  const fetchFake = (async (url: string, init: RequestInit) => {
    posts.push({ url, body: (JSON.parse(init.body as string) as { body: string }).body });
    return new Response(JSON.stringify({ id: `s${posts.length}` }));
  }) as unknown as typeof fetch;
  const push = (body: string): void =>
    (listeners.get("message") as (e: { data: string }) => void)({
      data: JSON.stringify({
        type: "message.created",
        cursor: "1",
        payload: { message: { id: "in-1", channel_id: "ch", author_user_id: "u", body } },
      }),
    });
  return { socket, fetchFake, posts, push };
}

function counting(): { hook: GatewayHook; platforms: PlatformName[] } {
  const platforms: PlatformName[] = [];
  return {
    platforms,
    hook: { name: "count", post_outbound: (ctx) => void platforms.push(ctx.event.platform) },
  };
}

describe("GatewayRunner drives ClickClackAdapter", () => {
  it("gives one frame one POST and one post_outbound for clickclack", async () => {
    const { socket, fetchFake, posts, push } = scripted();
    const { hook, platforms } = counting();
    let done: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => (done = resolve));
    const runner = new GatewayRunner({
      adapters: [
        new ClickClackAdapter({
          baseUrl: "https://cc.test",
          token: "t",
          workspaceId: "w",
          botUserId: "bot",
          fetch: fetchFake,
          socket: () => socket,
        }),
      ],
      hooks: [hook],
      handler: async (_event, ctx) => {
        await ctx.reply("hello back");
        done();
      },
    });
    running.push(runner);
    await runner.start();
    push("hello");
    await handled;
    expect(posts).toEqual([
      { url: "https://cc.test/api/channels/ch/messages", body: "hello back" },
    ]);
    expect(platforms).toEqual(["clickclack"]);
  });
});
