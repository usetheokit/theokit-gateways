/**
 * TelegramAdapter.editMessage — replaces a sent message's text through `editMessageText`.
 *
 * Every platform call is a spy on the bot's own `api` object, so nothing reaches
 * api.telegram.org. The E1 to E7 labels are the plan's shared edit behaviours
 * (gateway-preview-streaming, Phase 2).
 */

import type { OutboundMessage } from "@theokit/gateway";
import { GrammyError } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";
import { splitForTelegram } from "../src/split.js";

const CHANNEL = { id: "100", type: "dm" } as const;

function grammyError(code: number, description: string): GrammyError {
  return new GrammyError(
    `Call to 'editMessageText' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description },
    "editMessageText",
    {},
  );
}

/** The largest text length `splitForTelegram` still returns as one part, read from the splitter. */
function singlePartLimit(): number {
  let fits = 1;
  let splits = 1_000_000;
  while (splits - fits > 1) {
    const mid = Math.floor((fits + splits) / 2);
    if (splitForTelegram("a".repeat(mid)).length === 1) fits = mid;
    else splits = mid;
  }
  return fits;
}

describe("TelegramAdapter.editMessage", () => {
  let adapter: TelegramAdapter;
  let edit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new TelegramAdapter({ token: "fake:token" });
    edit = vi.fn(async () => true);
    vi.spyOn(adapter.getBot().api, "editMessageText").mockImplementation(edit as never);
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  const out = (text: string, format?: OutboundMessage["format"]): OutboundMessage => ({
    channel: CHANNEL,
    text,
    ...(format !== undefined ? { format } : {}),
  });

  it("reports supportsEdit as true before and after connect (E1)", async () => {
    expect(adapter.supportsEdit).toBe(true);
    vi.spyOn(adapter.getBot(), "init").mockResolvedValue(undefined);
    vi.spyOn(adapter.getBot(), "start").mockResolvedValue(undefined);
    vi.spyOn(adapter.getBot(), "stop").mockResolvedValue(undefined);
    await adapter.connect();
    expect(adapter.supportsEdit).toBe(true);
  });

  it("edits a sent message once with its id and the new text (E2)", async () => {
    const result = await adapter.editMessage("42", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "42" });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith(100, 42, "hello", {});
  });

  it("refuses a text the splitter would cut in two as edit_too_long with no request (E3)", async () => {
    const limit = singlePartLimit();

    const tooLong = await adapter.editMessage("42", out("a".repeat(limit + 1)));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error?.code).toBe("edit_too_long");
    expect(edit).toHaveBeenCalledTimes(0);

    const atLimit = await adapter.editMessage("42", out("a".repeat(limit)));
    expect(atLimit).toEqual({ ok: true, messageId: "42" });
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "Bad Request: message to edit not found", "telegram_400"],
    [429, "Too Many Requests: retry after 5", "rate_limited"],
    [403, "Forbidden: bot was blocked by the user", "no_permission"],
  ])(
    "maps a %i refusal through the send-error mapping without throwing (E4)",
    async (status, description, code) => {
      edit.mockRejectedValueOnce(grammyError(status, description));

      const result = await adapter.editMessage("42", out("hello"));

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(code);
      expect(edit).toHaveBeenCalledTimes(1);
    },
  );

  it("refuses empty text as empty_text with no request (E5)", async () => {
    const result = await adapter.editMessage("42", out(""));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(edit).toHaveBeenCalledTimes(0);
  });

  it("edits a whitespace-only text as sendMessage would send it (E5, split rule)", async () => {
    const result = await adapter.editMessage("42", out("   "));
    expect(result).toEqual({ ok: true, messageId: "42" });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith(100, 42, "   ", {});
  });

  it("refuses an empty message id as invalid_message_id with no request (E6)", async () => {
    const result = await adapter.editMessage("", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_message_id");
    expect(edit).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["markdown", { parse_mode: "Markdown" }],
    ["html", { parse_mode: "HTML" }],
    ["plain", {}],
  ] as const)("passes format %s as the send path does (E7)", async (format, options) => {
    await adapter.editMessage("42", out("hello", format));
    expect(edit).toHaveBeenCalledWith(100, 42, "hello", options);
  });

  it("refuses a non-numeric channel as invalid_channel with no request", async () => {
    const result = await adapter.editMessage("42", {
      channel: { id: "not-a-number", type: "dm" },
      text: "hello",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_channel");
    expect(edit).toHaveBeenCalledTimes(0);
  });

  it("treats an unchanged edit as a success", async () => {
    edit.mockRejectedValueOnce(grammyError(400, "Bad Request: message is not modified"));

    const result = await adapter.editMessage("42", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "42" });
  });

  it.each(["abc", "1.5", "-3", " 42", "0x10", "0", "00", "9007199254740993", "1".repeat(400)])(
    "refuses the message id %j as invalid_message_id with no request",
    async (messageId) => {
      const result = await adapter.editMessage(messageId, out("hello"));
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("invalid_message_id");
      expect(edit).toHaveBeenCalledTimes(0);
    },
  );

  it("makes one request per concurrent edit, each with its own id", async () => {
    const [first, second] = await Promise.all([
      adapter.editMessage("1", out("a")),
      adapter.editMessage("2", out("b")),
    ]);

    expect(first).toEqual({ ok: true, messageId: "1" });
    expect(second).toEqual({ ok: true, messageId: "2" });
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledWith(100, 1, "a", {});
    expect(edit).toHaveBeenCalledWith(100, 2, "b", {});
  });
});
