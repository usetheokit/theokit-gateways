/** Legacy Markdown parse refusals are resent as plain text, chunk by chunk. */

import { GrammyError } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";
import { splitForTelegram } from "../src/split.js";

const CHANNEL = { id: "100", type: "dm" } as const;

function grammyError(code: number, description: string): GrammyError {
  return new GrammyError(
    `Call to 'sendMessage' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description },
    "sendMessage",
    {},
  );
}

type Opts = { parse_mode?: string };

describe("TelegramAdapter markdown fallback", () => {
  let adapter: TelegramAdapter;
  let calls: Array<{ text: string; opts: Opts }>;
  let failWhen: (text: string, opts: Opts) => GrammyError | undefined;
  let nextId: number;

  beforeEach(() => {
    adapter = new TelegramAdapter({ token: "fake:token" });
    calls = [];
    nextId = 0;
    failWhen = (_t, opts) =>
      opts.parse_mode === "Markdown"
        ? grammyError(400, "Bad Request: can't parse entities: unmatched _")
        : undefined;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(adapter.getBot().api, "sendMessage").mockImplementation((async (
      _chat: number,
      text: string,
      opts: Opts,
    ) => {
      calls.push({ text, opts });
      const err = failWhen(text, opts);
      if (err) throw err;
      return { message_id: ++nextId };
    }) as never);
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("resends the chunk without parse_mode", async () => {
    const result = await adapter.sendMessage({
      channel: CHANNEL,
      text: "snake_case_",
      format: "markdown",
    });
    expect(result).toEqual({ ok: true, messageId: "1" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.opts.parse_mode).toBe("Markdown");
    expect(calls[1]?.text).toBe(calls[0]?.text);
    expect(calls[1]?.opts).not.toHaveProperty("parse_mode");
  });

  it("sends all three chunks in order when only the second fails to parse", async () => {
    const text = `${"a".repeat(4000)}\n\n${"b".repeat(4000)}\n\n${"c".repeat(4000)}`;
    const chunks = splitForTelegram(text);
    expect(chunks).toHaveLength(3);
    failWhen = (t, opts) =>
      opts.parse_mode === "Markdown" && t === chunks[1]
        ? grammyError(400, "Bad Request: can't parse entities")
        : undefined;
    const result = await adapter.sendMessage({ channel: CHANNEL, text, format: "markdown" });
    expect(result.ok).toBe(true);
    const plain = calls.filter((c) => c.opts.parse_mode === undefined);
    expect(plain.map((c) => c.text)).toEqual([chunks[1]]);
    const delivered = calls
      .filter((c) => c.text !== chunks[1] || c.opts.parse_mode === undefined)
      .map((c) => c.text);
    expect(delivered).toEqual(chunks);
  });

  it("does not resend a 403", async () => {
    failWhen = () => grammyError(403, "Forbidden: bot was blocked by the user");
    const result = await adapter.sendMessage({
      channel: CHANNEL,
      text: "hi_",
      format: "markdown",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "no_permission" } });
    expect(calls).toHaveLength(1);
  });
});
