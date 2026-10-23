/**
 * `GatewayRunner` over `SynologyChatAdapter`, offline (B-361 FR-007, AC-031).
 *
 * One outgoing callback goes through the runner, the handler replies through `ctx.reply`, and
 * exactly one `chatbot` post carries the reply while `post_outbound` fires once with platform
 * `synology_chat`. A post written straight to the adapter reaches the NAS and leaves
 * `post_outbound` at zero. The NAS is a scripted `fetch`, and the callback is handed to the
 * adapter's `handleCallback`, as its route does, so no port is opened.
 */

import { type GatewayHook, GatewayRunner, type PlatformName } from "@theokit/gateway";
import { SynologyChatAdapter } from "@theokit/gateway-synology-chat";
import { afterEach, describe, expect, it } from "vitest";

const TOKEN = "outgoing-token";
const INCOMING_URL =
  "https://nas.invalid/webapi/entry.cgi?api=SYNO.Chat.External&method=chatbot&version=2&token=%22x%22";

/** A NAS that accepts `user_list` and every `chatbot` post. */
class ScriptedNas {
  readonly posts: Array<{ text: string; user_ids: number[] }> = [];

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (url.searchParams.get("method") === "chatbot") {
      const payload = new URLSearchParams(String(init?.body ?? "")).get("payload") ?? "{}";
      this.posts.push(JSON.parse(payload));
    }
    return Response.json({ success: true });
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

function makeAdapter(nas: ScriptedNas): SynologyChatAdapter {
  return new SynologyChatAdapter({
    botToken: TOKEN,
    incomingUrl: INCOMING_URL,
    // The route is mounted on this stand-in and never served; the test calls handleCallback.
    app: { post: () => undefined } as never,
    fetch: nas.fetch,
  });
}

const running: GatewayRunner[] = [];

afterEach(async () => {
  for (const runner of running.splice(0)) await runner.stop();
});

describe("GatewayRunner drives SynologyChatAdapter", () => {
  it("gives one callback one chatbot post and one post_outbound for synology_chat", async () => {
    const nas = new ScriptedNas();
    const adapter = makeAdapter(nas);
    const { hook, platforms } = countingHook();
    let markHandled: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    const runner = new GatewayRunner({
      adapters: [adapter],
      hooks: [hook],
      handler: async (_event, ctx) => {
        await ctx.reply("hello back");
        markHandled();
      },
    });
    running.push(runner);
    await runner.start();

    const answer = await adapter.handleCallback(
      "application/x-www-form-urlencoded",
      new URLSearchParams({
        token: TOKEN,
        user_id: "42",
        username: "alice",
        post_id: "1",
        text: "hello",
      }).toString(),
    );
    await handled;

    expect(answer.status).toBe(200);
    expect(nas.posts).toEqual([{ text: "hello back", user_ids: [42] }]);
    expect(platforms).toEqual(["synology_chat"]);
  });

  it("leaves post_outbound at zero for a post written around the runner", async () => {
    const nas = new ScriptedNas();
    const adapter = makeAdapter(nas);
    const { hook, platforms } = countingHook();
    const runner = new GatewayRunner({
      adapters: [adapter],
      hooks: [hook],
      handler: async () => undefined,
    });
    running.push(runner);
    await runner.start();

    const result = await adapter.sendMessage({
      channel: { id: "42", type: "dm" },
      text: "written around the runner",
    });

    expect(result.ok).toBe(true);
    expect(nas.posts).toEqual([{ text: "written around the runner", user_ids: [42] }]);
    expect(platforms).toEqual([]);
  });
});
