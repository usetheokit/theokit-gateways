/**
 * `GatewayRunner` over `ZaloPersonalAdapter`, offline (B-365).
 *
 * One listener message goes through the runner, the handler replies through `ctx.reply`, and
 * exactly one Zalo send carries the reply while `post_outbound` fires once with platform
 * `zalo_personal`. A send written straight to the adapter reaches Zalo and leaves `post_outbound`
 * at zero. The `zca-js` API is a scripted fake.
 */

import { type GatewayHook, GatewayRunner, type PlatformName } from "@theokit/gateway";
import { type ZaloApi, ZaloPersonalAdapter } from "@theokit/gateway-zalo-personal";
import { afterEach, describe, expect, it } from "vitest";

function scriptedApi() {
  const sent: string[] = [];
  let onMessage: Parameters<ZaloApi["listener"]["on"]>[1] | undefined;
  const api: ZaloApi = {
    listener: {
      on: ((event: string, handler: never) => {
        if (event === "message") onMessage = handler;
      }) as ZaloApi["listener"]["on"],
      start: () => undefined,
      stop: () => undefined,
    },
    sendMessage: async (message) => {
      sent.push(message.msg);
      return { message: { msgId: sent.length } };
    },
  };
  const push = (content: string): void =>
    (onMessage as unknown as (m: unknown) => void)({
      type: 0,
      threadId: "peer",
      data: { msgId: "in-1", uidFrom: "peer", dName: "Linh", content },
    });
  return { api, sent, push };
}

function counting(): { hook: GatewayHook; platforms: PlatformName[] } {
  const platforms: PlatformName[] = [];
  return {
    platforms,
    hook: { name: "count", post_outbound: (ctx) => void platforms.push(ctx.event.platform) },
  };
}

const running: GatewayRunner[] = [];
afterEach(async () => {
  for (const runner of running.splice(0)) await runner.stop();
});

const credentials = { cookie: [], imei: "i", userAgent: "u" };

describe("GatewayRunner drives ZaloPersonalAdapter", () => {
  it("gives one message one Zalo send and one post_outbound for zalo_personal", async () => {
    const { api, sent, push } = scriptedApi();
    const { hook, platforms } = counting();
    let done: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => (done = resolve));
    const runner = new GatewayRunner({
      adapters: [new ZaloPersonalAdapter({ credentials, login: async () => api })],
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
    expect(sent).toEqual(["hello back"]);
    expect(platforms).toEqual(["zalo_personal"]);
  });

  it("leaves post_outbound at zero for a send written around the runner", async () => {
    const { api, sent } = scriptedApi();
    const adapter = new ZaloPersonalAdapter({ credentials, login: async () => api });
    const { hook, platforms } = counting();
    const runner = new GatewayRunner({
      adapters: [adapter],
      hooks: [hook],
      handler: async () => {},
    });
    running.push(runner);
    await runner.start();
    const result = await adapter.sendMessage({ channel: { id: "peer", type: "dm" }, text: "x" });
    expect(result.ok).toBe(true);
    expect(sent).toEqual(["x"]);
    expect(platforms).toEqual([]);
  });
});
