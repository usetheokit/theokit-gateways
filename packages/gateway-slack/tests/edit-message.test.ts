/**
 * SlackAdapter.editMessage — replaces a sent message's text through `chat.update`.
 *
 * `@slack/bolt` is mocked at module level, as `adapter.test.ts` does, with `chat.update` added to
 * the mock client; the mock is local to this file. The E1 to E7 labels are the plan's shared edit
 * behaviours (gateway-preview-streaming, Phase 2).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true, ts: "111.222" }));
const postMessageMock = vi.fn(async () => ({ ts: "111.222" }));

vi.mock("@slack/bolt", () => {
  class MockApp {
    public client = {
      auth: { test: async () => ({ user_id: "UBOT1234" }) },
      chat: { postMessage: postMessageMock, update: updateMock },
    };
    event = vi.fn();
    start = async () => undefined;
    stop = async () => undefined;
  }
  return { default: { App: MockApp }, App: MockApp };
});

import type { OutboundMessage } from "@theokit/gateway";
import { SlackAdapter } from "../src/adapter.js";
import { splitForSlack } from "../src/split.js";

const CHANNEL = { id: "C123", type: "group" } as const;

const out = (text: string, format?: OutboundMessage["format"]): OutboundMessage => ({
  channel: CHANNEL,
  text,
  ...(format !== undefined ? { format } : {}),
});

/** The largest text length `splitForSlack` still returns as one part, read from the splitter. */
function singlePartLimit(): number {
  let fits = 1;
  let splits = 1_000_000;
  while (splits - fits > 1) {
    const mid = Math.floor((fits + splits) / 2);
    if (splitForSlack("a".repeat(mid)).length === 1) fits = mid;
    else splits = mid;
  }
  return fits;
}

async function connected(): Promise<SlackAdapter> {
  const adapter = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
  expect(await adapter.connect()).toBe(true);
  return adapter;
}

beforeEach(() => {
  updateMock.mockReset().mockImplementation(async () => ({ ok: true, ts: "111.222" }));
  postMessageMock.mockReset().mockImplementation(async () => ({ ts: "111.222" }));
});

describe("SlackAdapter.editMessage", () => {
  it("reports supportsEdit as true before and after connect (E1)", async () => {
    const adapter = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    expect(adapter.supportsEdit).toBe(true);
    await adapter.connect();
    expect(adapter.supportsEdit).toBe(true);
  });

  it("edits a sent message once with its ts and the new text (E2)", async () => {
    const adapter = await connected();

    const result = await adapter.editMessage("111.222", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "111.222" });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ channel: "C123", ts: "111.222", text: "hello" });
  });

  it("refuses a text the splitter would cut in two as edit_too_long with no request (E3)", async () => {
    const adapter = await connected();
    const limit = singlePartLimit();

    const tooLong = await adapter.editMessage("111.222", out("a".repeat(limit + 1)));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error?.code).toBe("edit_too_long");
    expect(updateMock).toHaveBeenCalledTimes(0);

    const atLimit = await adapter.editMessage("111.222", out("a".repeat(limit)));
    expect(atLimit).toEqual({ ok: true, messageId: "111.222" });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["message_not_found", "platform_error"],
    ["rate_limited", "rate_limit"],
    ["missing_scope", "no_permission"],
  ])("maps a %s refusal through mapSlackError without throwing (E4)", async (slackError, code) => {
    const adapter = await connected();
    updateMock.mockRejectedValueOnce({ data: { error: slackError } });

    const result = await adapter.editMessage("111.222", out("hello"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(code);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("names message_not_found in the platform_error message (E4)", async () => {
    const adapter = await connected();
    updateMock.mockRejectedValueOnce({ data: { error: "message_not_found" } });

    const result = await adapter.editMessage("111.222", out("hello"));

    expect(result.error?.message).toContain("message_not_found");
  });

  it("refuses empty text as empty_text with no request (E5)", async () => {
    const adapter = await connected();
    const result = await adapter.editMessage("111.222", out(""));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(updateMock).toHaveBeenCalledTimes(0);
  });

  it("refuses an edit before connect as not_connected with no request (E5)", async () => {
    const adapter = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    const result = await adapter.editMessage("111.222", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
    expect(updateMock).toHaveBeenCalledTimes(0);
  });

  it("edits a whitespace-only text as sendMessage would send it (E5, split rule)", async () => {
    const adapter = await connected();
    const result = await adapter.editMessage("111.222", out("   "));
    expect(result).toEqual({ ok: true, messageId: "111.222" });
    expect(updateMock).toHaveBeenCalledWith({ channel: "C123", ts: "111.222", text: "   " });
  });

  it("refuses an empty message id as invalid_message_id with no request (E6)", async () => {
    const adapter = await connected();
    const result = await adapter.editMessage("", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_message_id");
    expect(updateMock).toHaveBeenCalledTimes(0);
  });

  it.each(["markdown", "plain"] as const)(
    "sends format %s text verbatim with no mrkdwn key (E7)",
    async (format) => {
      const adapter = await connected();
      await adapter.editMessage("111.222", out("*hi*", format));
      const args = updateMock.mock.calls[0]?.[0];
      expect(args).toEqual({ channel: "C123", ts: "111.222", text: "*hi*" });
      expect(args).not.toHaveProperty("mrkdwn");
    },
  );
});

describe("SlackAdapter.editMessage attachments (B-674)", () => {
  it("refuses an edit that carries an image with no platform call", async () => {
    const adapter = await connected();

    const result = await adapter.editMessage("111.222", {
      ...out("hello"),
      attachments: [{ kind: "image", mediaType: "image/png", data: new Uint8Array([1]) }],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("attachments_unsupported");
    expect(updateMock).toHaveBeenCalledTimes(0);
    expect(postMessageMock).toHaveBeenCalledTimes(0);
  });
});
