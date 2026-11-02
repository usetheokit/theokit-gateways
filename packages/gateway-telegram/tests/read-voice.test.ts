/**
 * A polled voice note reaches the handler with its audio (B-715, AC-002).
 *
 * Updates go through the adapter's own grammy bot (`handleUpdate`), so the bot filter, the
 * allow-list and the event mapping are the production ones. `getFile` is answered by a transformer on
 * the bot's api and `fetch` is stubbed, so nothing reaches api.telegram.org.
 */

import type { MessageEvent } from "@theokit/gateway";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";
import { parseInbound } from "../src/parse-inbound.js";

const TOKEN = "123:fake-token";
const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: "bot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as const;

interface VoiceFields {
  file_id?: unknown;
  duration?: unknown;
  mime_type?: unknown;
  file_size?: unknown;
}

let updateId = 0;

function update(message: Record<string, unknown>, fromId = 100): Update {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: 100, type: "private", first_name: "u" },
      from: { id: fromId, is_bot: false, first_name: "u" },
      ...message,
    },
  } as unknown as Update;
}

function voiceUpdate(voice: VoiceFields, fromId = 100): Update {
  return update({ voice: { file_unique_id: "u", ...voice } }, fromId);
}

function okResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200 });
}

describe("TelegramAdapter reads a polled voice note", () => {
  let adapter: TelegramAdapter;
  let events: MessageEvent[];
  let getFile: Mock<(fileId: string) => Promise<object>>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  function build(allowedUsers?: ReadonlyArray<string>): void {
    adapter = new TelegramAdapter({ token: TOKEN, ...(allowedUsers ? { allowedUsers } : {}) });
    adapter.getBot().botInfo = BOT_INFO as never;
    getFile = vi.fn(async (fileId: string) => ({
      file_id: fileId,
      file_unique_id: "u",
      file_path: `voice/${fileId}.oga`,
    }));
    // A transformer, not a spy: grammy builds a fresh `Api` for each update's context and copies
    // only the installed transformers onto it, so a spy on `bot.api` never sees `ctx.getFile()`.
    adapter.getBot().api.config.use(async (_prev, method, payload) => {
      if (method !== "getFile") throw new Error(`unexpected Bot API call: ${method}`);
      const fileId = (payload as { file_id: string }).file_id;
      return { ok: true, result: await getFile(fileId) } as never;
    });
    events = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });
  }

  beforeEach(() => {
    fetchSpy = vi.fn(async () => okResponse(new Uint8Array(9000).fill(7)));
    vi.stubGlobal("fetch", fetchSpy);
    build();
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a voice note reaches the handler with its bytes, media type and duration", async () => {
    await adapter
      .getBot()
      .handleUpdate(
        voiceUpdate({ file_id: "v1", duration: 3, mime_type: "audio/ogg", file_size: 9000 }),
      );

    expect(events).toHaveLength(1);
    const audio = events[0]?.audio;
    expect(audio?.mediaType).toBe("audio/ogg");
    expect(audio?.durationSeconds).toBe(3);
    expect(audio?.data).toBeInstanceOf(Uint8Array);
    expect(audio?.data.length).toBe(9000);
    expect(getFile).toHaveBeenCalledWith("v1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `https://api.telegram.org/file/bot${TOKEN}/voice/v1.oga`,
    );
  });

  it("the media type defaults to audio/ogg", async () => {
    await adapter.getBot().handleUpdate(voiceUpdate({ file_id: "v1", duration: 2 }));

    expect(events[0]?.audio?.mediaType).toBe("audio/ogg");
  });

  it("a text message produces an event with no audio key and 0 getFile calls", async () => {
    await adapter.getBot().handleUpdate(update({ text: "hello" }));

    expect(events).toHaveLength(1);
    expect("audio" in (events[0] ?? {})).toBe(false);
    expect(getFile).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a blocked sender triggers no getFile call", async () => {
    await adapter.disconnect();
    build(["999"]);
    await adapter.getBot().handleUpdate(voiceUpdate({ file_id: "v1", duration: 3 }, 100));

    expect(events).toHaveLength(0);
    expect(getFile).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the webhook parseInbound path reads no audio", () => {
    const event = parseInbound(voiceUpdate({ file_id: "v1", duration: 3 }));

    expect(event).not.toBeNull();
    expect("audio" in (event ?? {})).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("two voice notes keep their own bytes", async () => {
    fetchSpy.mockImplementation(async (url: unknown) =>
      okResponse(new Uint8Array(String(url).endsWith("a.oga") ? [1, 1] : [2, 2, 2])),
    );
    await adapter.getBot().handleUpdate(voiceUpdate({ file_id: "a", duration: 1 }));
    await adapter.getBot().handleUpdate(voiceUpdate({ file_id: "b", duration: 1 }));

    expect(Array.from(events[0]?.audio?.data ?? [])).toEqual([1, 1]);
    expect(Array.from(events[1]?.audio?.data ?? [])).toEqual([2, 2, 2]);
  });
});
