/**
 * The portable event may carry a voice note's audio, and an outbound message may carry an audio
 * attachment (B-715, AC-001).
 *
 * The type half of this file is checked by `tsc --noEmit`, which the package's `test` script runs
 * before vitest: a `kind` the union does not list is a compile error, asserted with
 * `@ts-expect-error`.
 */

import { describe, expect, it } from "vitest";

import type { OutboundAttachment } from "../../src/adapter/base.js";
import type { InboundAudio, MessageEvent } from "../../src/index.js";
import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

const voiceBytes = new Uint8Array([79, 103, 103, 83]);

function voiceEvent(audio: InboundAudio): MessageEvent {
  return {
    id: "tg-1",
    platform: "telegram",
    sender: { id: "100" },
    channel: { id: "1", type: "dm" },
    text: "",
    receivedAt: 0,
    audio,
    telegram: { chatId: 1, messageId: 1, raw: {} },
  };
}

/** A mock whose platform sends attachments, as Telegram's does. */
class AttachingMockAdapter extends MockAdapter {
  override readonly supportsAttachments = true;
}

describe("audio in the gateway contract (B-715)", () => {
  it("an event may carry audio with bytes, media type and duration", () => {
    const event = voiceEvent({ data: voiceBytes, mediaType: "audio/ogg", durationSeconds: 3 });

    expect(event.audio?.data).toBe(voiceBytes);
    expect(event.audio?.mediaType).toBe("audio/ogg");
    expect(event.audio?.durationSeconds).toBe(3);
  });

  it("an outbound audio attachment type-checks and a video kind does not", () => {
    const audio: OutboundAttachment = { kind: "audio", mediaType: "audio/ogg", data: voiceBytes };
    const video: OutboundAttachment = {
      // @ts-expect-error -- "video" is not a kind the union lists
      kind: "video",
      mediaType: "video/mp4",
      data: voiceBytes,
    };

    expect(audio.kind).toBe("audio");
    expect(video.mediaType).toBe("video/mp4");
  });

  it("a reply's audio attachment reaches sendMessage with the same bytes", async () => {
    const adapter = new AttachingMockAdapter("telegram");
    const attachment: OutboundAttachment = {
      kind: "audio",
      mediaType: "audio/ogg",
      data: voiceBytes,
      filename: "reply.ogg",
    };
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: async (_event, ctx) => {
        await ctx.reply("listen", { attachments: [attachment] });
      },
    });
    await runner.start();
    await adapter.emit(
      voiceEvent({ data: voiceBytes, mediaType: "audio/ogg", durationSeconds: 1 }),
    );
    await runner.stop();

    expect(adapter.sent).toHaveLength(1);
    const sent = adapter.sent[0]?.attachments?.[0];
    expect(sent?.kind).toBe("audio");
    expect(sent?.data).toBe(voiceBytes);
  });
});
