/**
 * `GatewayRunner` over the real `TelegramAdapter`, offline: a handler's `ctx.reply` with an image
 * reaches Telegram's `sendPhoto` (B-674, AC-001 with AC-003).
 *
 * The two halves are tested apart elsewhere: the runner with a mock adapter
 * (`packages/gateway/tests/runner/reply-attachments.test.ts`) and the adapter called directly
 * (`packages/gateway-telegram/tests/send-photo.test.ts`). This file drives the path the item exists
 * for, handler to platform call, in one run. Every grammy call is a spy on the bot's own `api`, and
 * `init`/`start`/`stop` are stubbed, so nothing reaches api.telegram.org.
 */

import {
  type GatewayHook,
  GatewayRunner,
  type MessageEvent,
  type OutboundAttachment,
  type SendResult,
} from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The part of grammy's `InputFile` this file reads. */
interface PhotoFile {
  toRaw(): Promise<Uint8Array>;
}

const chart: OutboundAttachment = {
  kind: "image",
  mediaType: "image/png",
  data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
};

function inbound(): MessageEvent {
  return {
    id: "tg-1",
    platform: "telegram",
    sender: { id: "100" },
    channel: { id: "100", type: "dm" },
    text: "draw the chart",
    receivedAt: 0,
    telegram: { chatId: 100, messageId: 1, raw: {} },
  };
}

/** A TelegramAdapter whose bot never dials Telegram, with spies on the two sends. */
function offlineTelegram(): {
  adapter: TelegramAdapter;
  sendPhoto: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
} {
  const adapter = new TelegramAdapter({ token: "fake:token" });
  const bot = adapter.getBot();
  vi.spyOn(bot, "init").mockResolvedValue(undefined);
  vi.spyOn(bot, "start").mockResolvedValue(undefined);
  vi.spyOn(bot, "stop").mockResolvedValue(undefined);
  const sendPhoto = vi.fn(async () => ({ message_id: 77 }));
  const sendText = vi.fn(async () => ({ message_id: 78 }));
  vi.spyOn(bot.api, "sendPhoto").mockImplementation(sendPhoto as never);
  vi.spyOn(bot.api, "sendMessage").mockImplementation(sendText as never);
  return { adapter, sendPhoto, sendText };
}

describe("GatewayRunner over TelegramAdapter: a reply image (B-674)", () => {
  let runner: GatewayRunner | undefined;

  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
    vi.restoreAllMocks();
  });

  it("sends a handler's reply image through sendPhoto with the text as its caption", async () => {
    const { adapter, sendPhoto, sendText } = offlineTelegram();
    const replies: SendResult[] = [];
    const seen: Parameters<NonNullable<GatewayHook["post_outbound"]>>[0][] = [];
    runner = new GatewayRunner({
      adapters: [adapter],
      handler: async (_event, ctx) => {
        replies.push(await ctx.reply("here is the chart", { attachments: [chart] }));
      },
      hooks: [{ name: "audit", post_outbound: (ctx) => void seen.push(ctx) }],
    });
    await runner.start();

    expect(await adapter.deliver(inbound())).toBe("ok");
    // stop() drains in-flight handlers, so the assertions below see the finished send.
    await runner.stop();

    expect(replies).toEqual([{ ok: true, messageId: "77" }]);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
    // grammy's InputFile, read through its own toRaw(); this package does not depend on grammy.
    const [chatId, file, options] = sendPhoto.mock.calls[0] as [number, PhotoFile, object];
    expect(chatId).toBe(100);
    expect(await file.toRaw()).toEqual(chart.data);
    expect(options).toMatchObject({ caption: "here is the chart" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.outbound.attachments?.[0]?.data).toBe(chart.data);
  });

  it("refuses an image too large for Telegram with no platform call", async () => {
    const { adapter, sendPhoto, sendText } = offlineTelegram();
    const replies: SendResult[] = [];
    const tooBig: OutboundAttachment = { ...chart, data: new Uint8Array(10 * 1024 * 1024 + 1) };
    runner = new GatewayRunner({
      adapters: [adapter],
      handler: async (_event, ctx) => {
        replies.push(await ctx.reply("here is the chart", { attachments: [tooBig] }));
      },
    });
    await runner.start();

    await adapter.deliver(inbound());
    await runner.stop();

    expect(replies[0]?.error?.code).toBe("invalid_attachment");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
});
