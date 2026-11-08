/**
 * `GatewayRunner` over `FeishuLarkAdapter`, offline (B-360 FR-007, AC-021).
 *
 * One `im.message.receive_v1` event goes through the runner, the handler replies through
 * `ctx.reply`, and exactly one `im.message.create` carries the reply while `post_outbound` fires
 * once with platform `feishu_lark`. A send written straight to the adapter reaches the transport
 * and leaves `post_outbound` at zero. The open platform is a scripted transport handed to the
 * adapter through its `transport` seam.
 */

import { type GatewayHook, GatewayRunner, type PlatformName } from "@theokit/gateway";
import {
  FeishuLarkAdapter,
  type LarkApiResult,
  type LarkConnectionHandlers,
  type LarkTransport,
} from "@theokit/gateway-feishu-lark";
import { afterEach, describe, expect, it } from "vitest";

/** An open platform that accepts every call and lets the test dispatch one event. */
class ScriptedLark implements LarkTransport {
  readonly created: Array<{ chatId: string; text: string }> = [];
  private handlers: LarkConnectionHandlers | undefined;

  async tenantToken(): Promise<LarkApiResult> {
    return { code: 0 };
  }

  async start(handlers: LarkConnectionHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async createMessage(chatId: string, text: string): Promise<LarkApiResult> {
    this.created.push({ chatId, text });
    return { code: 0, messageId: `om_${this.created.length}` };
  }

  async replyMessage(): Promise<LarkApiResult> {
    throw new Error("the runner replies to the chat, not to the message");
  }

  close(): void {}

  dispatch(text: string): void {
    this.handlers?.onMessage({
      event_id: "ev_1",
      sender: { sender_type: "user", sender_id: { open_id: "ou_peer" } },
      message: {
        message_id: "om_in",
        chat_id: "oc_chat",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text }),
      },
    });
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

function makeAdapter(lark: ScriptedLark): FeishuLarkAdapter {
  return new FeishuLarkAdapter({ appId: "cli_0123456789abcdef", appSecret: "s", transport: lark });
}

const running: GatewayRunner[] = [];

afterEach(async () => {
  for (const runner of running.splice(0)) await runner.stop();
});

describe("GatewayRunner drives FeishuLarkAdapter", () => {
  it("gives one inbound one im.message.create and one post_outbound for feishu_lark", async () => {
    const lark = new ScriptedLark();
    const { hook, platforms } = countingHook();
    let markHandled: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    const runner = new GatewayRunner({
      adapters: [makeAdapter(lark)],
      hooks: [hook],
      handler: async (_event, ctx) => {
        await ctx.reply("hello back");
        markHandled();
      },
    });
    running.push(runner);
    await runner.start();

    lark.dispatch("hello");
    await handled;

    expect(lark.created).toEqual([{ chatId: "oc_chat", text: "hello back" }]);
    expect(platforms).toEqual(["feishu_lark"]);
  });

  it("leaves post_outbound at zero for a send written around the runner", async () => {
    const lark = new ScriptedLark();
    const adapter = makeAdapter(lark);
    const { hook, platforms } = countingHook();
    const runner = new GatewayRunner({
      adapters: [adapter],
      hooks: [hook],
      handler: async () => undefined,
    });
    running.push(runner);
    await runner.start();

    const result = await adapter.sendMessage({
      channel: { id: "oc_chat", type: "dm" },
      text: "written around the runner",
    });

    expect(result.ok).toBe(true);
    expect(lark.created).toEqual([{ chatId: "oc_chat", text: "written around the runner" }]);
    expect(platforms).toEqual([]);
  });
});
