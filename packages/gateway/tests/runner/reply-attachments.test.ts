/**
 * `ctx.reply(text, { attachments })` carries an image to the adapter (B-674, AC-001).
 */

import { describe, expect, it } from "vitest";

import type { OutboundAttachment } from "../../src/adapter/base.js";
import type { PostOutboundContext } from "../../src/hooks/types.js";
import type { GatewayContext } from "../../src/runner/gateway-runner.js";
import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

function tg(text = "hi"): MessageEvent {
  return {
    id: "tg-1",
    platform: "telegram",
    sender: { id: "100" },
    channel: { id: "1", type: "dm" },
    text,
    receivedAt: 0,
    telegram: { chatId: 1, messageId: 1, raw: {} },
  };
}

const image: OutboundAttachment = {
  kind: "image",
  mediaType: "image/png",
  data: new Uint8Array([137, 80, 78, 71]),
};

async function replyOnce(
  reply: (ctx: GatewayContext) => Promise<unknown>,
  seen: PostOutboundContext[] = [],
): Promise<MockAdapter> {
  const adapter = new MockAdapter("telegram");
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: async (_event, ctx) => {
      await reply(ctx);
    },
    hooks: [{ name: "audit", post_outbound: (ctx) => void seen.push(ctx) }],
  });
  await runner.start();
  await adapter.emit(tg());
  // stop() drains in-flight handlers, so the assertions below see the finished send.
  await runner.stop();
  return adapter;
}

describe("ctx.reply attachments (B-674)", () => {
  it("a reply's image reaches sendMessage with the same bytes and media type", async () => {
    const adapter = await replyOnce((ctx) => ctx.reply("here", { attachments: [image] }));

    expect(adapter.sent).toHaveLength(1);
    const sentImage = adapter.sent[0]?.attachments?.[0];
    expect(sentImage?.mediaType).toBe("image/png");
    expect(sentImage?.data).toBe(image.data);
  });

  it("a reply without attachments builds an outbound with no attachments key", async () => {
    const adapter = await replyOnce((ctx) => ctx.reply("plain"));

    expect(adapter.sent).toHaveLength(1);
    expect("attachments" in (adapter.sent[0] ?? {})).toBe(false);
  });

  it("an empty attachments array is left out", async () => {
    const adapter = await replyOnce((ctx) => ctx.reply("plain", { attachments: [] }));

    expect(adapter.sent).toHaveLength(1);
    expect("attachments" in (adapter.sent[0] ?? {})).toBe(false);
  });

  it("a null attachments value from a JavaScript caller is left out, not thrown on", async () => {
    const nullList = null as unknown as ReadonlyArray<OutboundAttachment>;
    const adapter = await replyOnce((ctx) => ctx.reply("plain", { attachments: nullList }));

    expect(adapter.sent).toHaveLength(1);
    expect("attachments" in (adapter.sent[0] ?? {})).toBe(false);
  });

  it("post_outbound sees the attachments", async () => {
    const seen: PostOutboundContext[] = [];
    await replyOnce((ctx) => ctx.reply("here", { attachments: [image] }), seen);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.outbound.attachments).toHaveLength(1);
  });
});
