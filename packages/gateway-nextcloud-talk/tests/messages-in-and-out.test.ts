import { connect } from "node:net";

import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NextcloudTalkAdapter,
  type NextcloudTalkAdapterOptions,
  splitForTalk,
} from "../src/index.js";
import {
  BASE_URL,
  BOT_MESSAGE_URL,
  CREATE_BODY,
  capabilities,
  freePort,
  JOIN_BODY,
  REPLY_BODY,
  ROOM,
  type ScriptedTalk,
  SECRET,
  scriptedTalk,
  signedHeaders,
  talkSignature,
} from "./fixtures.js";

const open: NextcloudTalkAdapter[] = [];

function adapterFor(
  talk: ScriptedTalk,
  overrides: Partial<NextcloudTalkAdapterOptions> = {},
): NextcloudTalkAdapter {
  const adapter = new NextcloudTalkAdapter({
    baseUrl: BASE_URL,
    secret: SECRET,
    fetch: talk.fetch,
    ...overrides,
  });
  open.push(adapter);
  return adapter;
}

async function connected(talk: ScriptedTalk = scriptedTalk()): Promise<NextcloudTalkAdapter> {
  const adapter = adapterFor(talk, { port: await freePort() });
  expect(await adapter.connect()).toBe(true);
  return adapter;
}

/** Post `body` signed as Talk signs it, and return what the handler received. */
async function inbound(
  adapter: NextcloudTalkAdapter,
  body: unknown,
): Promise<{ status: number; events: MessageEvent[] }> {
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const answer = await adapter.handleRequest(signedHeaders(rawBody), rawBody);
  await new Promise((resolve) => setImmediate(resolve));
  return { status: answer.status, events };
}

/** Whether anything accepts a TCP connection on `port`. */
async function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const adapter of open.splice(0)) await adapter.disconnect();
});

describe("inbound", () => {
  it("turns a Create from a Person into a NextcloudTalkMessageEvent", async () => {
    const adapter = await connected();

    const { status, events } = await inbound(adapter, REPLY_BODY);

    expect(status).toBe(200);
    const [event] = events;
    if (event?.platform !== "nextcloud_talk") throw new Error(`platform ${event?.platform}`);
    expect(event.id).toBe("6");
    expect(event.sender).toEqual({ id: "users/admin", displayName: "admin" });
    expect(event.channel).toEqual({ id: ROOM, type: "group" });
    expect(event.text).toBe("user answer");
    expect(event.nextcloud_talk).toMatchObject({
      roomToken: ROOM,
      messageId: "6",
      actorId: "users/admin",
      replyToId: "2",
    });
  });

  it("a message that answers nothing has no replyToId", async () => {
    const adapter = await connected();

    const { events } = await inbound(adapter, CREATE_BODY);

    const [event] = events;
    if (event?.platform !== "nextcloud_talk") throw new Error(`platform ${event?.platform}`);
    expect(event.text).toBe("hello **bold** from B-358");
    expect(event.nextcloud_talk.replyToId).toBeUndefined();
  });

  it("a Join is not a message", async () => {
    const adapter = await connected();

    const { status, events } = await inbound(adapter, JOIN_BODY);

    expect(status).toBe(200);
    expect(events).toHaveLength(0);
  });

  it("a Create from an Application is not a message", async () => {
    const adapter = await connected();
    const fromBot = {
      ...CREATE_BODY,
      actor: { type: "Application", id: "bots/bot-1", name: "another bot" },
    };

    const { status, events } = await inbound(adapter, fromBot);

    expect(status).toBe(200);
    expect(events).toHaveLength(0);
  });

  it("a content that is not JSON gives no event and one stderr line", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = await connected();
    const broken = { ...CREATE_BODY, object: { ...CREATE_BODY.object, content: "not json" } };

    const { status, events } = await inbound(adapter, broken);

    expect(status).toBe(200);
    expect(events).toHaveLength(0);
    expect(stderr.mock.calls.filter(([text]) => String(text).includes("content"))).toHaveLength(1);
  });

  it("answers 503 to a verified message when no handler is registered", async () => {
    const adapter = await connected();
    const rawBody = JSON.stringify(CREATE_BODY);

    const answer = await adapter.handleRequest(signedHeaders(rawBody), rawBody);

    expect(answer.status).toBe(503);
  });

  it("a signed body that is not JSON answers 400", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = await connected();

    const { status, events } = await inbound(adapter, "not json at all");

    expect(status).toBe(400);
    expect(events).toHaveLength(0);
  });

  it("logs a handler that throws and still answers 200", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = await connected();
    adapter.onInbound(async () => {
      throw new Error("boom");
    });
    const rawBody = JSON.stringify(CREATE_BODY);

    const answer = await adapter.handleRequest(signedHeaders(rawBody), rawBody);
    await vi.waitFor(() =>
      expect(stderr.mock.calls.some(([text]) => String(text).includes("handler threw"))).toBe(true),
    );

    expect(answer.status).toBe(200);
  });
});

describe("outbound", () => {
  it("the bot signs random plus message", async () => {
    const talk = scriptedTalk();
    const adapter = await connected(talk);

    const result = await adapter.sendMessage({
      channel: { id: ROOM, type: "group" },
      text: "hello from the bot",
    });

    expect(talk.sends).toHaveLength(1);
    const [send] = talk.sends;
    if (send === undefined) throw new Error("no send");
    expect(send.url).toBe(BOT_MESSAGE_URL);
    expect(send.headers.get("ocs-apirequest")).toBe("true");
    const random = send.headers.get("x-nextcloud-talk-bot-random") ?? "";
    expect(random).toMatch(/^[0-9a-f]{64}$/);
    expect(send.headers.get("x-nextcloud-talk-bot-signature")).toBe(
      talkSignature(random, "hello from the bot"),
    );
    expect(send.body.message).toBe("hello from the bot");
    expect(send.body.referenceId).toMatch(/^[0-9a-f]{64}$/);
    expect(send.body.referenceId).not.toBe(random);
    expect(result).toEqual({ ok: true, messageId: send.body.referenceId });
  });

  it.each([
    [401, "talk_unauthorized"],
    [400, "talk_bad_request"],
    [413, "talk_http_error"],
    [500, "talk_http_error"],
  ])("answers HTTP %i with %s", async (status, code) => {
    const talk = scriptedTalk();
    const adapter = await connected(talk);
    talk.sendStatus = status;

    const result = await adapter.sendMessage({ channel: { id: ROOM, type: "group" }, text: "x" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(code);
  });

  it("32001 code points go out as two messages", async () => {
    const talk = scriptedTalk();
    const adapter = await connected(talk);
    // Astral characters: 32001 code points are 64002 UTF-16 units, so a count of units would cut
    // at 16000 characters instead.
    const text = "😀".repeat(32_001);

    const result = await adapter.sendMessage({ channel: { id: ROOM, type: "group" }, text });

    expect(result.ok).toBe(true);
    expect(talk.sends.map((send) => Array.from(send.body.message).length)).toEqual([32_000, 1]);
  });

  it("passes markdown through and sends html unchanged with one warning", async () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const talk = scriptedTalk();
    const adapter = await connected(talk);

    await adapter.sendMessage({
      channel: { id: ROOM, type: "group" },
      text: "**bold**",
      format: "markdown",
    });
    await adapter.sendMessage({
      channel: { id: ROOM, type: "group" },
      text: "<b>a</b>",
      format: "html",
    });
    await adapter.sendMessage({
      channel: { id: ROOM, type: "group" },
      text: "<b>b</b>",
      format: "html",
    });

    expect(talk.sends.map((send) => send.body.message)).toEqual([
      "**bold**",
      "<b>a</b>",
      "<b>b</b>",
    ]);
    expect(warn.mock.calls.filter(([text]) => String(text).includes("html"))).toHaveLength(1);
  });

  it.each([
    ["empty", ""],
    ["shorter than 40 characters", "x".repeat(39)],
    ["longer than 128 characters", "x".repeat(129)],
  ])("refuses a secret that is %s at construction", (_why, secret) => {
    expect(() => new NextcloudTalkAdapter({ baseUrl: BASE_URL, secret })).toThrow(
      /secret must be 40 to 128 characters/,
    );
  });

  it("names the part that failed when a long reply is refused halfway", async () => {
    const talk = scriptedTalk();
    const adapter = await connected(talk);
    // Three parts; Talk refuses the second.
    talk.sendStatusFor = (index) => (index === 1 ? 500 : 201);

    const result = await adapter.sendMessage({
      channel: { id: ROOM, type: "group" },
      text: "a".repeat(64_001),
    });

    expect(result.error?.code).toBe("talk_http_error");
    expect(result.error?.message).toContain("part 2 of 3");
    expect(talk.sends).toHaveLength(2);
  });

  it("refuses an empty text, a room token that is not one, and a send before connect", async () => {
    const talk = scriptedTalk();
    const idle = adapterFor(talk);
    const adapter = await connected(talk);

    const empty = await adapter.sendMessage({ channel: { id: ROOM, type: "group" }, text: "" });
    const badRoom = await adapter.sendMessage({
      channel: { id: "../../cloud/users", type: "group" },
      text: "x",
    });
    const early = await idle.sendMessage({ channel: { id: ROOM, type: "group" }, text: "x" });

    expect(empty.error?.code).toBe("empty_text");
    expect(badRoom.error?.code).toBe("invalid_room");
    expect(early.error?.code).toBe("not_connected");
    expect(talk.sends).toHaveLength(0);
  });
});

describe("splitForTalk", () => {
  it("leaves a text of exactly the limit whole", () => {
    expect(splitForTalk("a".repeat(32_000))).toHaveLength(1);
  });

  it("never cuts inside a surrogate pair", () => {
    const parts = splitForTalk(`a${"😀".repeat(4)}`, 2);

    expect(parts).toEqual(["a😀", "😀😀", "😀"]);
  });
});

describe("connect", () => {
  it("connect returns false without bots-v1", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const talk = scriptedTalk();
    talk.capabilities = capabilities(["chat-v2"]);
    const port = await freePort();
    const adapter = adapterFor(talk, { port });

    expect(await adapter.connect()).toBe(false);
    expect(await listening(port)).toBe(false);
  });

  it("returns false when the server does not answer the capabilities read", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const talk = scriptedTalk();
    talk.capabilities = undefined;
    const adapter = adapterFor(talk, { port: await freePort() });

    expect(await adapter.connect()).toBe(false);
  });

  it("returns false when the server is unreachable", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = adapterFor(scriptedTalk(), {
      port: await freePort(),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    expect(await adapter.connect()).toBe(false);
  });

  it("connect resolves false within connectTimeoutMs + 500 ms when the capabilities request never answers", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const talk = scriptedTalk();
    talk.capabilitiesHang = true;
    const port = await freePort();
    const adapter = adapterFor(talk, { port, connectTimeoutMs: 2_000 });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled: boolean | undefined;

    const connecting = adapter.connect().then((ok) => {
      settled = ok;
      return ok;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(501);

    expect(await connecting).toBe(false);
    expect(talk.lastCapabilitiesSignal?.aborted).toBe(true);
    vi.useRealTimers();
    expect(await listening(port)).toBe(false);
  });

  it("two overlapping connects share one capabilities read and one listener", async () => {
    const talk = scriptedTalk();
    const adapter = adapterFor(talk, { port: await freePort() });

    const answers = await Promise.all([adapter.connect(), adapter.connect()]);

    expect(answers).toEqual([true, true]);
    expect(talk.capabilityReads).toBe(1);
  });

  it("a disconnect while the capabilities read is pending leaves no listener", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const talk = scriptedTalk();
    let releaseRead: () => void = () => undefined;
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const port = await freePort();
    const adapter = adapterFor(talk, {
      port,
      fetch: async (input, init) => {
        if (input.includes("/cloud/capabilities")) await readHeld;
        return talk.fetch(input, init);
      },
    });

    const connecting = adapter.connect();
    await new Promise((resolve) => setImmediate(resolve));
    await adapter.disconnect();
    releaseRead();

    expect(await connecting).toBe(false);
    expect(talk.capabilityReads).toBe(1);
    expect(await listening(port)).toBe(false);
  });

  it("a second connect does not read the capabilities again", async () => {
    const talk = scriptedTalk();
    const adapter = await connected(talk);

    expect(await adapter.connect()).toBe(true);

    expect(talk.capabilityReads).toBe(1);
  });
});
