/**
 * TelegramAdapter.sendMessage with attachments — each image goes out through `sendPhoto` (B-674).
 *
 * Every platform call is a spy on the bot's own `api` object, so nothing reaches api.telegram.org.
 */

import type { OutboundAttachment, OutboundMessage } from "@theokit/gateway";
import { GrammyError, HttpError, InputFile } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";
import { splitForTelegram } from "../src/split.js";

const CHANNEL = { id: "100", type: "dm" } as const;
const CAPTION_LIMIT = 1024;
/** Telegram's limit on an uploaded photo (Bot API `sendPhoto`: "at most 10 MB"). */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** The most images one send takes. */
const MAX_PHOTOS = 10;

function image(bytes: number[] = [137, 80, 78, 71]): OutboundAttachment {
  return { kind: "image", mediaType: "image/png", data: new Uint8Array(bytes) };
}

function out(text: string, attachments: ReadonlyArray<OutboundAttachment>): OutboundMessage {
  return { channel: CHANNEL, text, attachments };
}

function grammyError(code: number, description: string): GrammyError {
  return new GrammyError(
    `Call to 'sendPhoto' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description },
    "sendPhoto",
    {},
  );
}

describe("TelegramAdapter.sendMessage with attachments", () => {
  let adapter: TelegramAdapter;
  let sendPhoto: ReturnType<typeof vi.fn>;
  let sendText: ReturnType<typeof vi.fn>;
  let nextId: number;

  beforeEach(() => {
    adapter = new TelegramAdapter({ token: "fake:token" });
    nextId = 41;
    sendPhoto = vi.fn(async () => ({ message_id: ++nextId }));
    sendText = vi.fn(async () => ({ message_id: ++nextId }));
    vi.spyOn(adapter.getBot().api, "sendPhoto").mockImplementation(sendPhoto as never);
    vi.spyOn(adapter.getBot().api, "sendMessage").mockImplementation(sendText as never);
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("sends an image through sendPhoto with the text as its caption", async () => {
    const picture = image();
    const result = await adapter.sendMessage(out("here it is", [picture]));

    expect(result).toEqual({ ok: true, messageId: "42" });
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
    const [chatId, file, options] = sendPhoto.mock.calls[0] as [number, InputFile, object];
    expect(chatId).toBe(100);
    expect(file).toBeInstanceOf(InputFile);
    expect(await file.toRaw()).toEqual(picture.data);
    expect(options).toMatchObject({ caption: "here it is" });
  });

  it("a 1024-unit text is the caption", async () => {
    const fits = "a".repeat(CAPTION_LIMIT);
    await adapter.sendMessage(out(fits, [image()]));

    expect(sendPhoto.mock.calls[0]?.[2]).toMatchObject({ caption: fits });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("a 1025-unit text follows the photos in the topic, without the reply target", async () => {
    const tooLong = "b".repeat(CAPTION_LIMIT + 1);
    const result = await adapter.sendMessage({
      ...out(tooLong, [image()]),
      replyTo: "7",
      channel: { ...CHANNEL, topicId: "9" },
    });

    expect(sendPhoto.mock.calls[0]?.[2]).not.toHaveProperty("caption");
    expect(sendPhoto.mock.calls[0]?.[2]).toMatchObject({
      reply_parameters: { message_id: 7 },
      message_thread_id: 9,
    });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[1]).toBe(tooLong);
    expect(sendText.mock.calls[0]?.[2]).toMatchObject({ message_thread_id: 9 });
    expect(sendText.mock.calls[0]?.[2]).not.toHaveProperty("reply_parameters");
    expect(result).toEqual({ ok: true, messageId: String(nextId) });
  });

  it("a text over one Telegram message follows the photos one chunk per sendMessage", async () => {
    const paragraph = `${"c".repeat(3000)}\n\n`;
    const longText = paragraph.repeat(3);
    const result = await adapter.sendMessage({
      ...out(longText, [image()]),
      replyTo: "7",
      channel: { ...CHANNEL, topicId: "9" },
    });

    const chunks = splitForTelegram(longText);
    expect(chunks.length).toBeGreaterThan(1);
    expect(sendText.mock.calls.map((call) => call[1])).toEqual(chunks);
    for (const call of sendText.mock.calls) {
      expect(call[2]).toMatchObject({ message_thread_id: 9 });
      expect(call[2]).not.toHaveProperty("reply_parameters");
    }
    expect(result).toEqual({ ok: true, messageId: String(nextId) });
  });

  it("a markdown caption rides with parse_mode Markdown", async () => {
    await adapter.sendMessage({ ...out("*bold*", [image()]), format: "markdown" });

    expect(sendPhoto.mock.calls[0]?.[2]).toMatchObject({
      caption: "*bold*",
      parse_mode: "Markdown",
    });
  });

  it("an html caption rides with parse_mode HTML", async () => {
    await adapter.sendMessage({ ...out("<b>bold</b>", [image()]), format: "html" });

    expect(sendPhoto.mock.calls[0]?.[2]).toMatchObject({ parse_mode: "HTML" });
  });

  it("passes an attachment's filename to the InputFile", async () => {
    await adapter.sendMessage(out("chart", [{ ...image(), filename: "chart.png" }]));

    const file = sendPhoto.mock.calls[0]?.[1] as InputFile;
    expect(file.filename).toBe("chart.png");
  });

  it("sends several images in order with the caption on the first", async () => {
    const first = image([1]);
    const second = image([2]);
    const result = await adapter.sendMessage({
      ...out("two", [first, second]),
      replyTo: "5",
      channel: { ...CHANNEL, topicId: "9" },
    });

    expect(sendPhoto).toHaveBeenCalledTimes(2);
    const calls = sendPhoto.mock.calls as Array<[number, InputFile, Record<string, unknown>]>;
    expect(await calls[0]?.[1].toRaw()).toEqual(first.data);
    expect(await calls[1]?.[1].toRaw()).toEqual(second.data);
    expect(calls[0]?.[2]).toMatchObject({ caption: "two", reply_parameters: { message_id: 5 } });
    expect(calls[1]?.[2]).not.toHaveProperty("caption");
    expect(calls[1]?.[2]).not.toHaveProperty("reply_parameters");
    expect(calls[0]?.[2]).toMatchObject({ message_thread_id: 9 });
    expect(calls[1]?.[2]).toMatchObject({ message_thread_id: 9 });
    expect(result).toEqual({ ok: true, messageId: "43" });
  });

  it("sends an image with empty text and no caption", async () => {
    const result = await adapter.sendMessage(out("", [image()]));

    expect(result.ok).toBe(true);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendPhoto.mock.calls[0]?.[2]).not.toHaveProperty("caption");
    expect(sendText).not.toHaveBeenCalled();
  });

  it("refuses an empty image with no platform call", async () => {
    const result = await adapter.sendMessage(out("hi", [image(), image([])]));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_attachment");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("refuses an attachment that is not an image with no platform call", async () => {
    const video = { ...image(), kind: "video" } as unknown as OutboundAttachment;
    const result = await adapter.sendMessage(out("hi", [video]));

    expect(result.error?.code).toBe("attachments_unsupported");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("maps a 429 from sendPhoto to rate_limited and stops the send", async () => {
    sendPhoto.mockRejectedValueOnce(grammyError(429, "Too Many Requests: retry after 3"));
    const rateLimited = await adapter.sendMessage(out("hi", [image(), image()]));

    expect(rateLimited.error?.code).toBe("rate_limited");
    expect(sendPhoto).toHaveBeenCalledTimes(1);
  });

  it("returns mapSendError's result when photo 2 is refused, photo 1 staying sent", async () => {
    sendPhoto
      .mockImplementationOnce(async () => ({ message_id: 50 }))
      .mockRejectedValueOnce(grammyError(400, "Bad Request: IMAGE_PROCESS_FAILED"));
    const result = await adapter.sendMessage(
      out("c".repeat(CAPTION_LIMIT + 1), [image(), image(), image()]),
    );

    // Photo 1 went out, photo 2 was refused (4xx), and nothing was sent after it.
    expect(sendPhoto).toHaveBeenCalledTimes(2);
    expect(sendText).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: { code: "telegram_400", message: "Bad Request: IMAGE_PROCESS_FAILED" },
    });
  });

  it("returns mapSendError's network_error when sendPhoto fails on the network", async () => {
    sendPhoto.mockRejectedValueOnce(new HttpError("Network request failed", new Error("down")));
    const result = await adapter.sendMessage(out("hi", [image(), image()]));

    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe("network_error");
  });

  it("declares supportsAttachments true", () => {
    expect(adapter.supportsAttachments).toBe(true);
  });

  it("refuses an image to a non-numeric channel with no platform call", async () => {
    const result = await adapter.sendMessage({
      channel: { id: "abc", type: "dm" },
      text: "hi",
      attachments: [image()],
    });

    expect(result.error?.code).toBe("invalid_channel");
    expect(sendPhoto).not.toHaveBeenCalled();
  });

  it("a 1-unit text is the caption", async () => {
    await adapter.sendMessage(out("x", [image()]));

    expect(sendPhoto.mock.calls[0]?.[2]).toMatchObject({ caption: "x" });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("maps a follow-up text failure after the photos", async () => {
    sendText.mockRejectedValueOnce(grammyError(403, "Forbidden: bot was blocked by the user"));
    const result = await adapter.sendMessage(out("c".repeat(CAPTION_LIMIT + 1), [image()]));

    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe("no_permission");
  });

  it("refuses an attachments value that is not an array", async () => {
    // A value with no numeric length: a `> 0` presence check would take it for "no attachments"
    // and send the text alone, which is the silent drop EC-1 forbids.
    const notAList = { channel: CHANNEL, text: "hi", attachments: {} } as unknown;
    const result = await adapter.sendMessage(notAList as OutboundMessage);

    expect(result.error?.code).toBe("invalid_attachment");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("sends the text alone when attachments is null", async () => {
    const nullList = { channel: CHANNEL, text: "hi", attachments: null } as unknown;
    const result = await adapter.sendMessage(nullList as OutboundMessage);

    expect(result.ok).toBe(true);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("sends ten images, the most one send takes", async () => {
    const ten = Array.from({ length: MAX_PHOTOS }, (_, index) => image([index + 1]));
    const result = await adapter.sendMessage(out("ten", ten));

    expect(result.ok).toBe(true);
    expect(sendPhoto).toHaveBeenCalledTimes(MAX_PHOTOS);
  });

  it("refuses eleven images with no platform call", async () => {
    const eleven = Array.from({ length: MAX_PHOTOS + 1 }, (_, index) => image([index + 1]));
    const result = await adapter.sendMessage(out("eleven", eleven));

    expect(result.error?.code).toBe("invalid_attachment");
    expect(result.error?.message).toContain("10");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("sends an image of exactly 10 MiB", async () => {
    const atLimit = { ...image(), data: new Uint8Array(MAX_PHOTO_BYTES) };
    const result = await adapter.sendMessage(out("big", [atLimit]));

    expect(result.ok).toBe(true);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
  });

  it("refuses an image one byte over 10 MiB before the first photo goes out", async () => {
    const tooBig = { ...image(), data: new Uint8Array(MAX_PHOTO_BYTES + 1) };
    const result = await adapter.sendMessage(out("big", [image(), image(), tooBig]));

    expect(result.error?.code).toBe("invalid_attachment");
    expect(result.error?.message).toContain("10 MiB");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
});
