/**
 * Two ways to wire a Telegram and a LINE channel, held to one behaviour suite (FR-006, NFR-005;
 * alignment AC-006).
 *
 * `hand-wired.ts` writes the per-platform joins an app wrote before B-018: two constructors, the
 * LINE signature check and the LINE dispatch. `descriptor-wired.ts` builds both from descriptors
 * with no per-platform branch. `measure-app-joinery.mjs --compare` counts the branch sites of each;
 * this suite is what keeps the comparison honest, because a fixture that drops a join to lower its
 * count must still pass every test here.
 *
 * Offline by construction. Telegram's bot API is answered by a grammy transformer and LINE's by a
 * global `fetch` stub, and both throw on any request they were not written for, so a push where a
 * reply was expected, or a call nobody planned, fails the test instead of reaching a network.
 */

import {
  GatewayConfigurationError,
  type GatewayHandler,
  type MessageEvent,
} from "@theokit/gateway";
import { computeLineSignature } from "@theokit/gateway-line";
import { TelegramAdapter } from "@theokit/gateway-telegram";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wireChannels as descriptorWired } from "../../src/channel-wiring/descriptor-wired.js";
import {
  type ChannelWiring,
  wireChannels as handWired,
} from "../../src/channel-wiring/hand-wired.js";

const SECRET = "offline-channel-secret";
const CONFIG = {
  telegram: { token: "123456:offline-token" },
  line: { channelSecret: SECRET, channelAccessToken: "offline-access-token" },
};
const BOT_INFO = "https://api.line.me/v2/bot/info";
const REPLY = "https://api.line.me/v2/bot/message/reply";

const GET_ME = {
  id: 123456,
  is_bot: true,
  first_name: "offline",
  username: "offline_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

interface LineRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
}

/** What each stub saw, so a test asserts the stubs it relies on were actually reached. */
interface Observed {
  readonly telegram: string[];
  readonly line: LineRequest[];
  /** Requests a stub refused. A refusal inside fire-and-forget dispatch is caught by the code under test, so this is what makes it fail the test. */
  readonly unexpected: string[];
}

function describeRequest(input: string | URL | Request, init?: RequestInit): LineRequest {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return { url, method, body: typeof init?.body === "string" ? init.body : undefined };
}

function botInfoResponse(status: number): Response {
  const body =
    status === 200 ? { userId: "Ubot", displayName: "bot" } : { message: "Authentication failed" };
  return Response.json(body, { status });
}

function stubLineApi(observed: Observed, botInfoStatus: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = describeRequest(input, init);
      observed.line.push(request);
      if (request.url === BOT_INFO && request.method === "GET")
        return botInfoResponse(botInfoStatus);
      if (request.url === REPLY && request.method === "POST")
        return Response.json({}, { status: 200 });
      const refused = `unexpected LINE API request: ${request.method} ${request.url}`;
      observed.unexpected.push(refused);
      throw new Error(refused);
    }),
  );
}

/** Answer getMe and sendMessage for the Telegram adapter, and keep it from long polling. */
function stubTelegramApi(wiring: ChannelWiring, observed: Observed): void {
  const bot = telegramAdapterOf(wiring).getBot();
  bot.api.config.use(async (_prev, method, payload) => {
    observed.telegram.push(method);
    if (method === "getMe") return { ok: true, result: GET_ME } as never;
    if (method === "sendMessage") {
      const chatId = (payload as { chat_id: number }).chat_id;
      const result = {
        message_id: 2,
        date: 0,
        chat: { id: chatId, type: "private" },
        text: "pong",
      };
      return { ok: true, result } as never;
    }
    const refused = `unexpected Telegram API method: ${method}`;
    observed.unexpected.push(refused);
    throw new Error(refused);
  });
  let stopPolling: (() => void) | undefined;
  bot.start = () =>
    new Promise<void>((resolve) => {
      stopPolling = resolve;
    });
  const stop = bot.stop.bind(bot);
  bot.stop = async () => {
    stopPolling?.();
    await stop();
  };
}

function telegramAdapterOf(wiring: ChannelWiring): TelegramAdapter {
  const adapter = wiring.adapters.find((a) => a instanceof TelegramAdapter);
  if (!(adapter instanceof TelegramAdapter)) throw new Error("no telegram adapter was built");
  return adapter;
}

function telegramUpdate(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: "private" as const, first_name: "Alice" },
      from: { id: 42, is_bot: false, first_name: "Alice" },
      text,
    },
  };
}

function lineBody(text: string, replyToken = "line-reply-token"): string {
  return JSON.stringify({
    destination: "Ubot",
    events: [
      {
        type: "message",
        replyToken,
        timestamp: 1,
        source: { type: "user", userId: "U-alice" },
        message: { id: "m-1", type: "text", text },
      },
    ],
  });
}

function signedRequest(rawBody: string) {
  return { rawBody, headers: { "x-line-signature": computeLineSignature(SECRET, rawBody) } };
}

async function waitFor(condition: () => boolean, what: string, deadlineMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > deadlineMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Both stubs the runner relies on once it started with a LINE adapter built. */
function expectBothStubsReached(observed: Observed): void {
  expect(observed.telegram).toContain("getMe");
  expect(observed.line.filter((r) => r.url === BOT_INFO).length).toBeGreaterThanOrEqual(1);
}

const wirings: ChannelWiring[] = [];
const observations: Observed[] = [];

afterEach(async () => {
  await Promise.all(wirings.splice(0).map((w) => w.runner.stop()));
  vi.unstubAllGlobals();
  const unexpected = observations.splice(0).flatMap((o) => o.unexpected);
  expect(unexpected, "a stub refused a request nobody planned").toEqual([]);
});

describe.each([
  ["hand-wired", handWired],
  ["descriptor-wired", descriptorWired],
])("%s channels", (_name, wireChannels) => {
  function setUp(
    options: {
      botInfoStatus?: number;
      config?: typeof CONFIG | ReturnType<typeof invalidLine>;
    } = {},
  ) {
    const observed: Observed = { telegram: [], line: [], unexpected: [] };
    observations.push(observed);
    stubLineApi(observed, options.botInfoStatus ?? 200);
    const handler = vi.fn<GatewayHandler>(async (_event: MessageEvent, ctx) => {
      await ctx.reply("pong");
    });
    const wiring = wireChannels(options.config ?? CONFIG, { handler });
    wirings.push(wiring);
    stubTelegramApi(wiring, observed);
    return { observed, handler, wiring };
  }

  it("starts telegram and line and reports both connected", async () => {
    const { observed, wiring } = setUp();

    const result = await wiring.runner.start();

    expect(result).toEqual({ connected: ["telegram", "line"], failed: [] });
    expectBothStubsReached(observed);
  });

  it("delivers a telegram update to the handler and replies through the bot api", async () => {
    const { observed, handler, wiring } = setUp();
    await wiring.runner.start();

    await telegramAdapterOf(wiring).getBot().handleUpdate(telegramUpdate("hello"));

    await waitFor(() => observed.telegram.includes("sendMessage"), "the telegram reply");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ platform: "telegram", text: "hello" });
    expect(observed.telegram.filter((m) => m === "sendMessage")).toHaveLength(1);
    expectBothStubsReached(observed);
  });

  it("delivers a signed line webhook body and replies with the cached reply token", async () => {
    const { observed, handler, wiring } = setUp();
    await wiring.runner.start();

    const outcome = await wiring.ingestWebhook("line", signedRequest(lineBody("hi line")));

    expect(outcome).toBe("delivered");
    await waitFor(() => observed.line.some((r) => r.url === REPLY), "the line reply request");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ platform: "line", text: "hi line" });
    const replies = observed.line.filter((r) => r.url === REPLY);
    expect(replies).toHaveLength(1);
    expect(JSON.parse(replies[0]?.body ?? "{}")).toMatchObject({ replyToken: "line-reply-token" });
    expectBothStubsReached(observed);
  });

  it("refuses a line webhook body whose signature does not match", async () => {
    const { observed, handler, wiring } = setUp();
    await wiring.runner.start();
    const request = signedRequest(lineBody("hi"));

    const outcome = await wiring.ingestWebhook("line", {
      ...request,
      rawBody: lineBody("tampered"),
    });

    expect(outcome).toBe("unauthorized");
    expect(handler).not.toHaveBeenCalled();
    expectBothStubsReached(observed);
  });

  it("reports a line webhook body with no events array as malformed", async () => {
    const { observed, handler, wiring } = setUp();
    await wiring.runner.start();

    expect(await wiring.ingestWebhook("line", signedRequest('{"destination":"Ubot"}'))).toBe(
      "malformed",
    );
    expect(await wiring.ingestWebhook("line", signedRequest("not json"))).toBe("malformed");
    expect(handler).not.toHaveBeenCalled();
    expectBothStubsReached(observed);
  });

  it("rejects an invalid line configuration and still starts telegram", async () => {
    const { observed, wiring } = setUp({ config: invalidLine() });

    const result = await wiring.runner.start();

    expect(wiring.rejected).toHaveLength(1);
    expect(wiring.rejected[0]?.platform).toBe("line");
    // The core error coded missing_required_config: the channel was refused before any
    // constructor ran, which LineAdapter's own ConfigurationError for an empty secret would not show.
    expect(wiring.rejected[0]?.error).toBeInstanceOf(GatewayConfigurationError);
    expect(wiring.rejected[0]?.error.code).toBe("missing_required_config");
    expect(wiring.rejected[0]?.error.message).toContain("channelSecret");
    expect(result).toEqual({ connected: ["telegram"], failed: [] });
    expect(observed.telegram).toContain("getMe");
    expect(observed.line.filter((r) => r.url === BOT_INFO)).toHaveLength(0);
    expect(await wiring.ingestWebhook("line", signedRequest(lineBody("hi")))).toBe(
      "unknown_channel",
    );
  });

  it("reports a line channel whose connect fails and keeps telegram", async () => {
    const { observed, wiring } = setUp({ botInfoStatus: 401 });
    const quiet = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await wiring.runner.start().finally(() => quiet.mockRestore());

    expect(result.connected).toEqual(["telegram"]);
    expect(result.failed.map((f) => f.platform)).toEqual(["line"]);
    expectBothStubsReached(observed);
  });

  it("answers no_handler for a line webhook body after line failed to connect", async () => {
    const { observed, handler, wiring } = setUp({ botInfoStatus: 401 });
    const quiet = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await wiring.runner.start().finally(() => quiet.mockRestore());

    const outcome = await wiring.ingestWebhook("line", signedRequest(lineBody("lost?")));

    expect(outcome).toBe("no_handler");
    await wiring.runner.stop();
    expect(handler).not.toHaveBeenCalled();
    expect(observed.line.filter((r) => r.url === REPLY)).toHaveLength(0);
  });

  it("answers no_handler for a line webhook body that arrives before start", async () => {
    const { handler, wiring } = setUp();

    const outcome = await wiring.ingestWebhook("line", signedRequest(lineBody("too early")));

    expect(outcome).toBe("no_handler");
    expect(handler).not.toHaveBeenCalled();
  });
});

function invalidLine() {
  return { ...CONFIG, line: { channelSecret: "", channelAccessToken: "offline-access-token" } };
}
