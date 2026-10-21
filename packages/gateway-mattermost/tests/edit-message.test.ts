/**
 * MattermostAdapter.editMessage — replaces a sent post's text through `Client4.patchPost`.
 *
 * A mock handle is injected the way `adapter.test.ts` does (assigning `handle` and `connected`),
 * with `patchPost` on its client; nothing reaches a Mattermost server. The E1 to E7 labels are the
 * plan's shared edit behaviours (gateway-preview-streaming, Phase 2).
 */

import type { OutboundMessage } from "@theokit/gateway";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MattermostAdapter } from "../src/adapter.js";
import { splitForMattermost } from "../src/split.js";

const CHANNEL = { id: "ch-1", type: "group" } as const;

const out = (text: string, format?: OutboundMessage["format"]): OutboundMessage => ({
  channel: CHANNEL,
  text,
  ...(format !== undefined ? { format } : {}),
});

/** The largest text length `splitForMattermost` still returns as one part, read from the splitter. */
function singlePartLimit(): number {
  let fits = 1;
  let splits = 1_000_000;
  while (splits - fits > 1) {
    const mid = Math.floor((fits + splits) / 2);
    if (splitForMattermost("a".repeat(mid)).length === 1) fits = mid;
    else splits = mid;
  }
  return fits;
}

function newAdapter(): MattermostAdapter {
  return new MattermostAdapter({ baseUrl: "https://mm.example.com", accessToken: "tok" });
}

let patchPost: ReturnType<typeof vi.fn>;

function connectedAdapter(): MattermostAdapter {
  const adapter = newAdapter();
  const handle = {
    botUserId: "u-bot",
    botUsername: "theo",
    channelCache: new Map(),
    client: { patchPost },
    ws: { close: () => undefined },
  };
  (adapter as unknown as { handle: unknown }).handle = handle;
  (adapter as unknown as { connected: boolean }).connected = true;
  return adapter;
}

beforeEach(() => {
  patchPost = vi.fn(async (patch: { id: string; message: string }) => ({
    id: patch.id,
    message: patch.message,
  }));
});

describe("MattermostAdapter.editMessage", () => {
  it("reports supportsEdit as true before and after connect (E1)", () => {
    expect(newAdapter().supportsEdit).toBe(true);
    expect(connectedAdapter().supportsEdit).toBe(true);
  });

  it("edits a sent post once with its id and the new text (E2)", async () => {
    const result = await connectedAdapter().editMessage("post-1", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "post-1" });
    expect(patchPost).toHaveBeenCalledTimes(1);
    expect(patchPost).toHaveBeenCalledWith({ id: "post-1", message: "hello" });
  });

  it("refuses a text the splitter would cut in two as edit_too_long with no request (E3)", async () => {
    const adapter = connectedAdapter();
    const limit = singlePartLimit();

    const tooLong = await adapter.editMessage("post-1", out("a".repeat(limit + 1)));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error?.code).toBe("edit_too_long");
    expect(patchPost).toHaveBeenCalledTimes(0);

    const atLimit = await adapter.editMessage("post-1", out("a".repeat(limit)));
    expect(atLimit).toEqual({ ok: true, messageId: "post-1" });
    expect(patchPost).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, "send_failed"],
    [429, "rate_limit"],
    [403, "permission_denied"],
  ])(
    "maps a %i refusal through the send-error mapping without throwing (E4)",
    async (status, code) => {
      patchPost.mockRejectedValueOnce(
        Object.assign(new Error(`refused ${status}`), { status_code: status }),
      );

      const result = await connectedAdapter().editMessage("post-1", out("hello"));

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(code);
      expect(patchPost).toHaveBeenCalledTimes(1);
    },
  );

  it("refuses empty text as empty_text with no request (E5)", async () => {
    const result = await connectedAdapter().editMessage("post-1", out(""));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(patchPost).toHaveBeenCalledTimes(0);
  });

  it("refuses an edit before connect as not_connected with no request (E5)", async () => {
    const result = await newAdapter().editMessage("post-1", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
    expect(patchPost).toHaveBeenCalledTimes(0);
  });

  it("edits a whitespace-only text as sendMessage would send it (E5, split rule)", async () => {
    const result = await connectedAdapter().editMessage("post-1", out("   "));
    expect(result).toEqual({ ok: true, messageId: "post-1" });
    expect(patchPost).toHaveBeenCalledWith({ id: "post-1", message: "   " });
  });

  it("refuses an empty message id as invalid_message_id with no request (E6)", async () => {
    const result = await connectedAdapter().editMessage("", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_message_id");
    expect(patchPost).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["plain", "\\*hi\\*"],
    ["markdown", "*hi*"],
  ] as const)(
    "applies format %s to the message as the send path does (E7)",
    async (format, message) => {
      await connectedAdapter().editMessage("post-1", out("*hi*", format));
      expect(patchPost).toHaveBeenCalledWith({ id: "post-1", message });
    },
  );
});
