/**
 * An unreadable voice note fails open (B-715, AC-003): the event is delivered without `audio`, one
 * stderr line names the reason, and nothing throws.
 *
 * The delivery cases go through the adapter's own grammy bot, with `getFile` answered by an api
 * transformer and `fetch` stubbed. The bound and timeout cases call `readVoice` directly with a
 * fake context and an injected `fetch`, so the clock can be faked without grammy in the way.
 */

import type { MessageEvent } from "@theokit/gateway";
import type { Context } from "grammy";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";
import { readVoice } from "../src/read-voice.js";

const TOKEN = "123:secret-token-value";
const MAX_VOICE_BYTES = 20971520;
const TIMEOUT_MS = 30000;
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

let updateId = 0;

function voiceUpdate(voice: Record<string, unknown>): Update {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: 100, type: "private", first_name: "u" },
      from: { id: 100, is_bot: false, first_name: "u" },
      voice: { file_unique_id: "u", ...voice },
    },
  } as unknown as Update;
}

function fakeContext(voice: Record<string, unknown>): Context {
  return {
    message: { voice },
    getFile: async () => ({ file_id: "v1", file_unique_id: "u", file_path: "voice/v1.oga" }),
  } as unknown as Context;
}

/** A fetch that resolves only when its signal aborts, then rejects as fetch does. */
function stalledFetch(): (url: string, init: { signal: AbortSignal }) => Promise<Response> {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
}

/** A 200 response whose body sends nothing after the headers. */
function stalledBody(): Response {
  return new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) }));
}

describe("an unreadable voice note fails open", () => {
  let adapter: TelegramAdapter;
  let events: MessageEvent[];
  let getFile: Mock<(fileId: unknown) => Promise<object>>;
  let fetchSpy: Mock<(url: unknown) => Promise<Response>>;
  let stderr: string[];

  beforeEach(() => {
    adapter = new TelegramAdapter({ token: TOKEN });
    adapter.getBot().botInfo = BOT_INFO as never;
    getFile = vi.fn(async () => ({
      file_id: "v1",
      file_unique_id: "u",
      file_path: "voice/v1.oga",
    }));
    adapter.getBot().api.config.use(async (_prev, method, payload) => {
      if (method !== "getFile") throw new Error(`unexpected Bot API call: ${method}`);
      return {
        ok: true,
        result: await getFile((payload as { file_id: unknown }).file_id),
      } as never;
    });
    fetchSpy = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchSpy);
    events = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function voiceLines(): string[] {
    return stderr.filter((line) => line.startsWith("[telegram] voice not read:"));
  }

  it("getFile rejecting delivers the event without audio and one stderr line", async () => {
    getFile.mockRejectedValue(new Error("Bad Request: file is too big"));
    await adapter.getBot().handleUpdate(voiceUpdate({ file_id: "v1", duration: 3 }));

    expect(events).toHaveLength(1);
    expect("audio" in (events[0] ?? {})).toBe(false);
    expect(voiceLines()).toEqual(["[telegram] voice not read: get_file_failed\n"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a 404 download does the same", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    await adapter.getBot().handleUpdate(voiceUpdate({ file_id: "v1", duration: 3 }));

    expect(events).toHaveLength(1);
    expect("audio" in (events[0] ?? {})).toBe(false);
    expect(voiceLines()).toEqual(["[telegram] voice not read: download_status_404\n"]);
  });

  it("a file_size over 20971520 makes 0 fetch calls", async () => {
    await adapter
      .getBot()
      .handleUpdate(voiceUpdate({ file_id: "v1", duration: 3, file_size: MAX_VOICE_BYTES + 1 }));

    expect(events).toHaveLength(1);
    expect("audio" in (events[0] ?? {})).toBe(false);
    expect(getFile).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(voiceLines()).toEqual(["[telegram] voice not read: too_large\n"]);
  });

  it("the stderr line never contains the bot token", async () => {
    fetchSpy.mockRejectedValue(new TypeError(`fetch failed for /file/bot${TOKEN}/voice/v1.oga`));
    await adapter.getBot().handleUpdate(voiceUpdate({ file_id: "v1", duration: 3 }));

    expect(voiceLines()).toEqual(["[telegram] voice not read: download_failed\n"]);
    expect(stderr.join("")).not.toContain(TOKEN);
    expect(stderr.join("")).not.toContain("secret-token-value");
  });

  it("a voice with malformed fields still delivers an event", async () => {
    await adapter
      .getBot()
      .handleUpdate(voiceUpdate({ file_id: "v1", duration: "three", mime_type: 7 }));

    expect(events).toHaveLength(1);
    expect(events[0]?.audio?.durationSeconds).toBe(0);
    expect(events[0]?.audio?.mediaType).toBe("audio/ogg");

    await adapter.getBot().handleUpdate(voiceUpdate({ duration: 3 }));

    expect(events).toHaveLength(2);
    expect("audio" in (events[1] ?? {})).toBe(false);
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(voiceLines()).toEqual(["[telegram] voice not read: no_file_id\n"]);
  });
});

describe("readVoice bounds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a download that returns more than 20971520 bytes is dropped", async () => {
    const big = async () => new Response(new Uint8Array(MAX_VOICE_BYTES + 4096));
    const read = await readVoice(fakeContext({ file_id: "v1", duration: 1 }), TOKEN, big);

    expect(read).toEqual({ reason: "too_large" });
  });

  it("20971520 bytes is read and 20971521 is dropped", async () => {
    const exact = async () => new Response(new Uint8Array(MAX_VOICE_BYTES));
    const over = async () => new Response(new Uint8Array(MAX_VOICE_BYTES + 1));

    const read = await readVoice(fakeContext({ file_id: "v1", duration: 1 }), TOKEN, exact);
    expect("audio" in read ? read.audio.data.length : read.reason).toBe(MAX_VOICE_BYTES);
    expect(await readVoice(fakeContext({ file_id: "v1", duration: 1 }), TOKEN, over)).toEqual({
      reason: "too_large",
    });
  });

  it("a stalled download aborts at the timeout", async () => {
    vi.useFakeTimers();
    const pending = readVoice(fakeContext({ file_id: "v1", duration: 1 }), TOKEN, stalledFetch());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await pending).toEqual({ reason: "timeout" });
  });

  it("a getFile that never answers aborts at the timeout, with 0 fetch calls", async () => {
    // The deadline covers the whole read: a stalled getFile would otherwise hold the polling
    // handler, and every later update, as a stalled download would (NFR-006).
    vi.useFakeTimers();
    const fetchSpy = vi.fn(stalledFetch());
    const ctx = {
      message: { voice: { file_id: "v1", duration: 1 } },
      getFile: (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    } as unknown as Context;
    let settled: unknown;
    void readVoice(ctx, TOKEN, fetchSpy).then((value) => {
      settled = value;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(settled).toEqual({ reason: "timeout" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a body that stalls after the headers aborts at the timeout", async () => {
    vi.useFakeTimers();
    const pending = readVoice(fakeContext({ file_id: "v1", duration: 1 }), TOKEN, async () =>
      stalledBody(),
    );
    let settled: unknown;
    void pending.then((value) => {
      settled = value;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(settled).toEqual({ reason: "timeout" });
  });

  it("a 200 response with a null body is download_failed", async () => {
    const empty = async () => new Response(null, { status: 200 });

    await expect(
      readVoice(fakeContext({ file_id: "v1", duration: 1 }), TOKEN, empty),
    ).resolves.toEqual({ reason: "download_failed" });
  });
});
