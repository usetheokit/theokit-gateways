/**
 * TelegramAdapter.sendMessage with an audio attachment — it goes out through `sendVoice` (B-715,
 * AC-004).
 *
 * Every platform call is a spy on the bot's own `api` object, so nothing reaches api.telegram.org.
 */

import {
  GatewayRunner,
  type MessageEvent,
  type OutboundAttachment,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";
import { GrammyError, InputFile } from "grammy";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";

const CHANNEL = { id: "100", type: "dm" } as const;
const CAPTION_LIMIT = 1024;
/** The bound this adapter puts on an outbound audio attachment: 50 MiB. */
const MAX_AUDIO_BYTES = 52428800;

type Send = Mock<(...args: unknown[]) => Promise<{ message_id: number }>>;

function audio(bytes: Uint8Array = new Uint8Array([79, 103, 103, 83]), mediaType = "audio/ogg") {
  return { kind: "audio", mediaType, data: bytes } as const satisfies OutboundAttachment;
}

function image(): OutboundAttachment {
  return { kind: "image", mediaType: "image/png", data: new Uint8Array([137, 80, 78, 71]) };
}

function out(text: string, attachments: ReadonlyArray<OutboundAttachment>): OutboundMessage {
  return { channel: CHANNEL, text, attachments };
}

describe("TelegramAdapter.sendMessage with an audio attachment", () => {
  let adapter: TelegramAdapter;
  let sendVoice: Send;
  let sendPhoto: Send;
  let sendText: Send;
  let nextId: number;

  beforeEach(() => {
    adapter = new TelegramAdapter({ token: "fake:token" });
    nextId = 42;
    sendVoice = vi.fn(async () => ({ message_id: nextId++ }));
    sendPhoto = vi.fn(async () => ({ message_id: nextId++ }));
    sendText = vi.fn(async () => ({ message_id: nextId++ }));
    const api = adapter.getBot().api;
    vi.spyOn(api, "sendVoice").mockImplementation(sendVoice as never);
    vi.spyOn(api, "sendPhoto").mockImplementation(sendPhoto as never);
    vi.spyOn(api, "sendMessage").mockImplementation(sendText as never);
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  function noCalls(): void {
    expect(sendVoice).not.toHaveBeenCalled();
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  }

  it("sends an audio attachment through sendVoice with the text as its caption", async () => {
    const clip = audio();
    const result = await adapter.sendMessage(out("listen", [clip]));

    expect(result).toEqual({ ok: true, messageId: "42" });
    expect(sendVoice).toHaveBeenCalledTimes(1);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    const [chatId, file, options] = sendVoice.mock.calls[0] as [number, InputFile, object];
    expect(chatId).toBe(100);
    expect(file).toBeInstanceOf(InputFile);
    expect(await file.toRaw()).toEqual(clip.data);
    expect(options).toMatchObject({ caption: "listen" });
  });

  it("a 1024-unit text is the caption and a 1025-unit text is not", async () => {
    const fits = "a".repeat(CAPTION_LIMIT);
    await adapter.sendMessage(out(fits, [audio()]));
    expect(sendVoice.mock.calls[0]?.[2]).toMatchObject({ caption: fits });
    expect(sendText).not.toHaveBeenCalled();

    const long = "b".repeat(CAPTION_LIMIT + 1);
    await adapter.sendMessage(out(long, [audio()]));
    expect(sendVoice.mock.calls[1]?.[2]).not.toHaveProperty("caption");
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[1]).toBe(long);
  });

  it("an empty or non-audio audio attachment is refused with 0 calls", async () => {
    const empty = await adapter.sendMessage(out("x", [audio(new Uint8Array(0))]));
    const notAudio = await adapter.sendMessage(out("x", [audio(undefined, "text/plain")]));

    expect(empty).toMatchObject({ ok: false, error: { code: "invalid_attachment" } });
    expect(notAudio).toMatchObject({ ok: false, error: { code: "invalid_attachment" } });
    noCalls();
  });

  it("an audio attachment over 52428800 bytes is refused with 0 calls", async () => {
    const result = await adapter.sendMessage(
      out("x", [audio(new Uint8Array(MAX_AUDIO_BYTES + 1))]),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_attachment" } });
    noCalls();
  });

  it("52428800 bytes is sent and 52428801 is refused", async () => {
    const atBound = await adapter.sendMessage(out("x", [audio(new Uint8Array(MAX_AUDIO_BYTES))]));
    expect(atBound).toEqual({ ok: true, messageId: "42" });

    const over = await adapter.sendMessage(out("x", [audio(new Uint8Array(MAX_AUDIO_BYTES + 1))]));
    expect(over).toMatchObject({ ok: false, error: { code: "invalid_attachment" } });
    expect(sendVoice).toHaveBeenCalledTimes(1);
  });

  it("audio/ogg; codecs=opus and Audio/OGG are accepted, video/mp4 is refused", async () => {
    expect(
      await adapter.sendMessage(out("x", [audio(undefined, "audio/ogg; codecs=opus")])),
    ).toMatchObject({ ok: true });
    expect(await adapter.sendMessage(out("x", [audio(undefined, "Audio/OGG")]))).toMatchObject({
      ok: true,
    });
    expect(await adapter.sendMessage(out("x", [audio(undefined, "video/mp4")]))).toMatchObject({
      ok: false,
      error: { code: "invalid_attachment" },
    });
    expect(sendVoice).toHaveBeenCalledTimes(2);
  });

  it("an unlisted kind is attachments_unsupported with 0 calls", async () => {
    const video = { ...audio(), kind: "video" } as unknown as OutboundAttachment;
    const result = await adapter.sendMessage(out("x", [video]));

    expect(result).toMatchObject({ ok: false, error: { code: "attachments_unsupported" } });
    noCalls();
  });

  it("an image and an audio entry go out in order with the caption on the first", async () => {
    const result = await adapter.sendMessage({
      ...out("both", [image(), audio()]),
      replyTo: "7",
    });

    expect(result).toEqual({ ok: true, messageId: "43" });
    expect(sendPhoto.mock.calls[0]?.[2]).toMatchObject({
      caption: "both",
      reply_parameters: { message_id: 7 },
    });
    expect(sendVoice.mock.calls[0]?.[2]).not.toHaveProperty("caption");
    expect(sendVoice.mock.calls[0]?.[2]).not.toHaveProperty("reply_parameters");
    expect(sendPhoto.mock.invocationCallOrder[0]).toBeLessThan(
      sendVoice.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("a thrown sendVoice is mapped and ends the send", async () => {
    sendVoice.mockRejectedValue(
      new GrammyError(
        "Call to 'sendVoice' failed! (403: Forbidden: bot was blocked by the user)",
        { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
        "sendVoice",
        {},
      ),
    );
    const result = await adapter.sendMessage(
      out("x".repeat(CAPTION_LIMIT + 1), [audio(), audio()]),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "no_permission" } });
    expect(sendVoice).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("an audio-only reply with empty text sends no caption and no text message", async () => {
    const result = await adapter.sendMessage(out("", [audio()]));

    expect(result).toEqual({ ok: true, messageId: "42" });
    expect(sendVoice.mock.calls[0]?.[2]).not.toHaveProperty("caption");
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe("GatewayRunner over TelegramAdapter: a reply voice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a ctx.reply with an audio attachment, through a GatewayRunner built on the adapter, reaches sendVoice", async () => {
    const adapter = new TelegramAdapter({ token: "fake:token" });
    const bot = adapter.getBot();
    vi.spyOn(bot, "init").mockResolvedValue(undefined);
    vi.spyOn(bot, "start").mockResolvedValue(undefined);
    vi.spyOn(bot, "stop").mockResolvedValue(undefined);
    const sendVoice = vi.fn(async () => ({ message_id: 77 }));
    vi.spyOn(bot.api, "sendVoice").mockImplementation(sendVoice as never);
    const clip = audio();
    const replies: SendResult[] = [];
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: async (_event, ctx) => {
        replies.push(await ctx.reply("spoken", { attachments: [clip] }));
      },
    });
    await runner.start();
    const inbound: MessageEvent = {
      id: "tg-1",
      platform: "telegram",
      sender: { id: "100" },
      channel: { id: "100", type: "dm" },
      text: "",
      receivedAt: 0,
      telegram: { chatId: 100, messageId: 1, raw: {} },
    };

    expect(await adapter.deliver(inbound)).toBe("ok");
    await runner.stop();

    expect(replies).toEqual([{ ok: true, messageId: "77" }]);
    expect(sendVoice).toHaveBeenCalledTimes(1);
  });
});
