/**
 * MatrixAdapter.editMessage — replaces a sent message with an `m.replace` event.
 *
 * Matrix has no edit call: an edit is a new event whose `m.relates_to` names the original and
 * whose `m.new_content` holds the new text, which clients render over the original (Matrix
 * Client-Server API v1.12, § Event replacements). The adapter is connected through
 * `__clientFactory` with a fake client, as `adapter.test.ts` does; nothing reaches a homeserver.
 * The E1 to E7 labels are the plan's shared edit behaviours (gateway-preview-streaming, Phase 2).
 */

import type { OutboundMessage } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";
import { replaceContent } from "../src/replace-content.js";

interface FakeClient {
  sendMessage?: ReturnType<typeof vi.fn>;
  sendTextMessage: ReturnType<typeof vi.fn>;
  getRoomIdForAlias: ReturnType<typeof vi.fn>;
  encrypted: Set<string>;
}

function fakeClient(opts: { withSendMessage?: boolean } = {}) {
  const fake: FakeClient = {
    sendTextMessage: vi.fn(async () => ({ event_id: "$text:server" })),
    getRoomIdForAlias: vi.fn(async (alias: string) => ({ room_id: `!resolved-${alias}:server` })),
    encrypted: new Set<string>(),
    ...(opts.withSendMessage === false
      ? {}
      : { sendMessage: vi.fn(async () => ({ event_id: "$replacement:server" })) }),
  };
  const client = {
    ...(fake.sendMessage !== undefined ? { sendMessage: fake.sendMessage } : {}),
    sendTextMessage: fake.sendTextMessage,
    getRoomIdForAlias: fake.getRoomIdForAlias,
    on: () => undefined,
    off: () => undefined,
    whoami: async () => ({ user_id: "@bot:example.org" }),
    startClient: async () => undefined,
    stopClient: () => undefined,
    getRoom: () => null,
    isRoomEncrypted: (roomId: string) => fake.encrypted.has(roomId),
    getUserId: () => "@bot:example.org",
  };
  return { fake, client };
}

function newAdapter(client?: unknown): MatrixAdapter {
  return new MatrixAdapter({
    homeserverUrl: "https://matrix.example.org",
    accessToken: "t",
    userId: "@bot:example.org",
    __clientFactory: () => client as never,
  });
}

async function connected(opts: { withSendMessage?: boolean } = {}) {
  const { fake, client } = fakeClient(opts);
  const adapter = newAdapter(client);
  expect(await adapter.connect()).toBe(true);
  return { adapter, fake };
}

const ROOM = "!room:server";

const out = (
  text: string,
  format?: OutboundMessage["format"],
  channelId: string = ROOM,
): OutboundMessage => ({
  channel: { id: channelId, type: "group" },
  text,
  ...(format !== undefined ? { format } : {}),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replaceContent", () => {
  it("builds m.new_content, the '* ' fallback body and an m.replace relation to the original", () => {
    expect(replaceContent("$orig", out("hello world", "plain"))).toEqual({
      msgtype: "m.text",
      body: "* hello world",
      "m.new_content": { msgtype: "m.text", body: "hello world" },
      "m.relates_to": { rel_type: "m.replace", event_id: "$orig" },
    });
  });

  it("carries formatted_body in both places for html", () => {
    const content = replaceContent("$orig", out("<b>hi</b>", "html"));
    expect(content).toEqual({
      msgtype: "m.text",
      body: "* <b>hi</b>",
      format: "org.matrix.custom.html",
      formatted_body: "* <b>hi</b>",
      "m.new_content": {
        msgtype: "m.text",
        body: "<b>hi</b>",
        format: "org.matrix.custom.html",
        formatted_body: "<b>hi</b>",
      },
      "m.relates_to": { rel_type: "m.replace", event_id: "$orig" },
    });
  });

  it.each(["plain", "markdown", undefined] as const)(
    "carries no formatted_body for format %s",
    (format) => {
      const content = replaceContent("$orig", out("**hi**", format));
      expect(content).not.toHaveProperty("formatted_body");
      expect(content["m.new_content"]).not.toHaveProperty("formatted_body");
    },
  );
});

describe("MatrixAdapter.editMessage", () => {
  it("reports supportsEdit as true at construction and after connect (E1)", async () => {
    expect(newAdapter().supportsEdit).toBe(true);
    const { adapter } = await connected();
    expect(adapter.supportsEdit).toBe(true);
    await adapter.disconnect();
  });

  it("sends one m.replace event and returns the original id (E2)", async () => {
    const { adapter, fake } = await connected();

    const result = await adapter.editMessage("$orig:server", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "$orig:server" });
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
    expect(fake.sendMessage).toHaveBeenCalledWith(
      ROOM,
      replaceContent("$orig:server", out("hello")),
    );
    expect(fake.sendTextMessage).toHaveBeenCalledTimes(0);
    await adapter.disconnect();
  });

  it("edits a text of 70,000 characters in one event, with no length check", async () => {
    const { adapter, fake } = await connected();

    const result = await adapter.editMessage("$orig:server", out("a".repeat(70_000)));

    expect(result).toEqual({ ok: true, messageId: "$orig:server" });
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
    await adapter.disconnect();
  });

  it.each([
    [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }, "rate_limit"],
    [{ errcode: "M_FORBIDDEN", httpStatus: 403 }, "permission_denied"],
  ])("maps a %j refusal without throwing (E4)", async (fields, code) => {
    const { adapter, fake } = await connected();
    fake.sendMessage?.mockRejectedValueOnce(Object.assign(new Error("refused"), fields));

    const result = await adapter.editMessage("$orig:server", out("hello"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(code);
    await adapter.disconnect();
  });

  it("maps a failed alias lookup without throwing and sends nothing", async () => {
    const { adapter, fake } = await connected();
    fake.getRoomIdForAlias.mockRejectedValueOnce(
      Object.assign(new Error("no such alias"), { errcode: "M_NOT_FOUND", httpStatus: 404 }),
    );

    const result = await adapter.editMessage(
      "$orig:server",
      out("hello", undefined, "#gone:server"),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_found");
    expect(fake.sendMessage).toHaveBeenCalledTimes(0);
    await adapter.disconnect();
  });

  it("refuses empty text as empty_text with no request (E5)", async () => {
    const { adapter, fake } = await connected();
    const result = await adapter.editMessage("$orig:server", out(""));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(fake.sendMessage).toHaveBeenCalledTimes(0);
    await adapter.disconnect();
  });

  it("refuses an edit before connect as not_connected (E5)", async () => {
    const result = await newAdapter().editMessage("$orig:server", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
  });

  it("refuses an empty message id as invalid_message_id with no request (E6)", async () => {
    const { adapter, fake } = await connected();
    const result = await adapter.editMessage("", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_message_id");
    expect(fake.sendMessage).toHaveBeenCalledTimes(0);
    await adapter.disconnect();
  });

  it("sends html as formatted content and warns once for markdown, as the send path does (E7)", async () => {
    const { adapter, fake } = await connected();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await adapter.editMessage("$orig:server", out("<b>hi</b>", "html"));
    await adapter.editMessage("$orig:server", out("**hi**", "markdown"));

    expect(fake.sendMessage).toHaveBeenNthCalledWith(
      1,
      ROOM,
      replaceContent("$orig:server", out("<b>hi</b>", "html")),
    );
    expect(fake.sendMessage).toHaveBeenNthCalledWith(
      2,
      ROOM,
      replaceContent("$orig:server", out("**hi**", "markdown")),
    );
    const warnings = stderr.mock.calls.filter(([line]) =>
      String(line).includes("no markdown mode"),
    );
    expect(warnings).toHaveLength(1);
    await adapter.disconnect();
  });

  it("answers edit_unsupported with no request when the client has no sendMessage", async () => {
    const { adapter, fake } = await connected({ withSendMessage: false });

    const result = await adapter.editMessage("$orig:server", out("hello"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("edit_unsupported");
    expect(fake.sendTextMessage).toHaveBeenCalledTimes(0);
    expect(fake.getRoomIdForAlias).toHaveBeenCalledTimes(0);
    await adapter.disconnect();
  });

  it("answers encrypted_room_unsupported with no send for an encrypted room", async () => {
    const { adapter, fake } = await connected();
    fake.encrypted.add(ROOM);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await adapter.editMessage("$orig:server", out("hello"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("encrypted_room_unsupported");
    expect(fake.sendMessage).toHaveBeenCalledTimes(0);
    stderr.mockRestore();
    await adapter.disconnect();
  });

  it("makes 0 alias lookups and 1 send for a room id and for an alias a send resolved", async () => {
    const { adapter, fake } = await connected();

    await adapter.editMessage("$orig:server", out("hello"));
    expect(fake.getRoomIdForAlias).toHaveBeenCalledTimes(0);
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);

    await adapter.sendMessage(out("first", undefined, "#warm:server"));
    fake.getRoomIdForAlias.mockClear();
    fake.sendMessage?.mockClear();
    fake.sendTextMessage.mockClear();

    await adapter.editMessage("$orig:server", out("hello", undefined, "#warm:server"));
    expect(fake.getRoomIdForAlias).toHaveBeenCalledTimes(0);
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
    await adapter.disconnect();
  });

  it("makes 1 alias lookup and 1 send, 2 in all, for an alias never resolved (D7)", async () => {
    const { adapter, fake } = await connected();

    await adapter.editMessage("$orig:server", out("hello", undefined, "#cold:server"));

    expect(fake.getRoomIdForAlias).toHaveBeenCalledTimes(1);
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
    expect(fake.sendMessage).toHaveBeenCalledWith(
      "!resolved-#cold:server:server",
      replaceContent("$orig:server", out("hello", undefined, "#cold:server")),
    );
    await adapter.disconnect();
  });
});
