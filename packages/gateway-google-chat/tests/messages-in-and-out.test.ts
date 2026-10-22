import { request } from "node:http";
import { createServer } from "node:net";

import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleChatAdapter, type GoogleChatAdapterOptions } from "../src/index.js";
import {
  APP_PRIVATE_KEY_PEM,
  AUDIENCE,
  idToken,
  messageEvent,
  NOW_MS,
  type ScriptedGoogle,
  SERVICE_ACCOUNT,
  scriptedGoogle,
  TOKEN_URL,
} from "./fixtures.js";

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === "object" && address !== null ? address.port : 0),
      );
    });
  });
}

const open: GoogleChatAdapter[] = [];

/** Wait until `condition` holds, polling every 5 ms, or fail naming what never happened. */
async function until(condition: () => boolean, what: string, deadlineMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > deadlineMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function connected(
  google: ScriptedGoogle,
  overrides: Partial<GoogleChatAdapterOptions> = {},
): Promise<GoogleChatAdapter> {
  const adapter = new GoogleChatAdapter({
    serviceAccountEmail: SERVICE_ACCOUNT,
    privateKey: APP_PRIVATE_KEY_PEM,
    audience: AUDIENCE,
    port: await freePort(),
    fetch: google.fetch,
    now: () => NOW_MS,
    ...overrides,
  });
  open.push(adapter);
  expect(await adapter.connect()).toBe(true);
  return adapter;
}

async function inbound(
  adapter: GoogleChatAdapter,
  body: Record<string, unknown>,
): Promise<MessageEvent[]> {
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  await adapter.handleRequest(`Bearer ${idToken()}`, JSON.stringify(body));
  await new Promise((resolve) => setImmediate(resolve));
  return events;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const adapter of open.splice(0)) await adapter.disconnect();
});

describe("inbound", () => {
  it("turns a MESSAGE event into a GoogleChatMessageEvent", async () => {
    const adapter = await connected(scriptedGoogle());

    const [event] = await inbound(adapter, messageEvent());

    if (event?.platform !== "google_chat") throw new Error(`platform ${event?.platform}`);
    expect(event.id).toBe("spaces/AAA/messages/M1");
    expect(event.sender).toEqual({ id: "users/111", displayName: "Ana" });
    expect(event.channel).toEqual({ id: "spaces/AAA", type: "group" });
    expect(event.google_chat.spaceType).toBe("SPACE");
    expect(event.google_chat.threadName).toBe("spaces/AAA/threads/T1");
  });

  it("argumentText wins over text", async () => {
    const adapter = await connected(scriptedGoogle());

    const [event] = await inbound(adapter, messageEvent());

    expect(event?.text).toBe("hello there");
  });

  it("uses text when argumentText is blank", async () => {
    const adapter = await connected(scriptedGoogle());

    const [event] = await inbound(
      adapter,
      messageEvent({
        message: { name: "spaces/AAA/messages/M2", text: "plain", argumentText: "  " },
      }),
    );

    expect(event?.text).toBe("plain");
  });

  it("a DM space is a dm channel", async () => {
    const adapter = await connected(scriptedGoogle());

    const [event] = await inbound(
      adapter,
      messageEvent({ space: { name: "spaces/DDD", type: "DM", spaceType: "DIRECT_MESSAGE" } }),
    );

    expect(event?.channel).toEqual({ id: "spaces/DDD", type: "dm" });
  });

  it("answers 200 to an event that is not a message and delivers nothing", async () => {
    const adapter = await connected(scriptedGoogle());
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });

    const answer = await adapter.handleRequest(
      `Bearer ${idToken()}`,
      JSON.stringify({ type: "ADDED_TO_SPACE", space: { name: "spaces/AAA" } }),
    );

    expect(answer).toEqual({ status: 200, body: {} });
    expect(events).toEqual([]);
  });

  it("serves the verified route over HTTP", async () => {
    const port = await freePort();
    const adapter = await connected(scriptedGoogle(), { port, path: "/chat" });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });

    const refused = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messageEvent()),
    });
    const accepted = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken()}` },
      body: JSON.stringify(messageEvent()),
    });

    expect(refused.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect(events).toHaveLength(1);
  });
});

describe("the route refuses before it holds a body", () => {
  it("answers 413 to a body over 1 MiB and calls no handler", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const port = await freePort();
    const adapter = await connected(scriptedGoogle(), { port });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });

    const answer = await fetch(`http://127.0.0.1:${port}/google-chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken()}` },
      body: "x".repeat(1024 * 1024 + 1),
    });

    expect(answer.status).toBe(413);
    expect(events).toHaveLength(0);
  });

  it("answers 401 to a request with no bearer token without waiting for its body", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const port = await freePort();
    await connected(scriptedGoogle(), { port });

    // The headers promise a body that never comes: only a refusal made before reading answers.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/google-chat",
          method: "POST",
          headers: { "content-type": "application/json", "content-length": "1000" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          req.destroy();
        },
      );
      req.on("error", reject);
      req.flushHeaders();
      setTimeout(() => {
        req.destroy();
        reject(new Error("no answer within 2000 ms: the route waited for the body"));
      }, 2_000).unref();
    });

    expect(status).toBe(401);
  });
});

describe("outbound", () => {
  it("sends to the space with a service-account token and returns the message name", async () => {
    const google = scriptedGoogle();
    const adapter = await connected(google);

    const result = await adapter.sendMessage({
      channel: { id: "spaces/AAA", type: "group" },
      text: "hi",
    });

    expect(result).toEqual({ ok: true, messageId: "spaces/AAA/messages/OUT1" });
    expect(google.sends).toEqual([
      {
        url: "https://chat.googleapis.com/v1/spaces/AAA/messages",
        text: "hi",
        authorization: "Bearer token-1",
      },
    ]);
    expect(google.lastTokenForm?.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
  });

  it("the access token is reused until 60 s before expiry", async () => {
    const google = scriptedGoogle();
    let now = NOW_MS;
    const adapter = await connected(google, { now: () => now });
    const send = () =>
      adapter.sendMessage({ channel: { id: "spaces/AAA", type: "group" }, text: "hi" });

    await send();
    now += 3_539_000;
    await send();
    expect(google.tokenExchanges).toBe(1);
    now += 1_000;
    await send();

    expect(google.tokenExchanges).toBe(2);
    expect(google.sends.map((s) => s.authorization)).toEqual([
      "Bearer token-1",
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  it("two sends with an expired token share one exchange", async () => {
    const google = scriptedGoogle();
    let now = NOW_MS;
    const adapter = await connected(google, { now: () => now });
    now += 3_600_000;

    await Promise.all([
      adapter.sendMessage({ channel: { id: "spaces/AAA", type: "group" }, text: "one" }),
      adapter.sendMessage({ channel: { id: "spaces/AAA", type: "group" }, text: "two" }),
    ]);

    expect(google.tokenExchanges).toBe(2);
  });

  it("maps a failed exchange to google_chat_auth_error", async () => {
    const google = scriptedGoogle();
    let now = NOW_MS;
    const adapter = await connected(google, { now: () => now });
    now += 3_600_000;
    google.tokenStatus = 400;

    const result = await adapter.sendMessage({
      channel: { id: "spaces/AAA", type: "group" },
      text: "hi",
    });

    expect(result.error?.code).toBe("google_chat_auth_error");
    expect(google.sends).toEqual([]);
  });

  it("maps a refused send to google_chat_http_error with the status", async () => {
    const google = scriptedGoogle();
    const adapter = await connected(google);
    google.sendStatus = 403;

    const result = await adapter.sendMessage({
      channel: { id: "spaces/AAA", type: "group" },
      text: "hi",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("google_chat_http_error");
    expect(result.error?.message).toContain("403");
  });

  it("refuses a channel id that is not a space name", async () => {
    const google = scriptedGoogle();
    const adapter = await connected(google);

    const result = await adapter.sendMessage({
      channel: { id: "spaces/AAA/../x", type: "group" },
      text: "hi",
    });

    expect(result.error?.code).toBe("invalid_space");
    expect(google.sends).toEqual([]);
  });

  it("strips markdown markers before sending", async () => {
    const google = scriptedGoogle();
    const adapter = await connected(google);

    await adapter.sendMessage({
      channel: { id: "spaces/AAA", type: "group" },
      text: "**Hi** _there_",
      format: "markdown",
    });

    expect(google.sends[0]?.text).toBe("Hi there");
  });

  it("refuses empty text and a send before connect", async () => {
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      fetch: scriptedGoogle().fetch,
    });

    const empty = await adapter.sendMessage({
      channel: { id: "spaces/AAA", type: "dm" },
      text: "",
    });
    const early = await adapter.sendMessage({
      channel: { id: "spaces/AAA", type: "dm" },
      text: "x",
    });

    expect(empty.error?.code).toBe("empty_text");
    expect(early.error?.code).toBe("not_connected");
  });
});

describe("connect", () => {
  it("connect returns false when the token exchange fails", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    google.tokenStatus = 401;
    const port = await freePort();
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      port,
      fetch: google.fetch,
    });

    await expect(adapter.connect()).resolves.toBe(false);
    await expect(
      fetch(`http://127.0.0.1:${port}/google-chat`, { method: "POST" }),
    ).rejects.toThrow();
  });

  it("connect returns false when the private key is not a PEM key", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: "not a key",
      audience: AUDIENCE,
      fetch: google.fetch,
    });

    await expect(adapter.connect()).resolves.toBe(false);
    expect(google.tokenExchanges).toBe(0);
  });

  it("reads a key whose line breaks arrive as \\n", async () => {
    const google = scriptedGoogle();

    const adapter = await connected(google, {
      privateKey: APP_PRIVATE_KEY_PEM.replaceAll("\n", "\\n"),
    });

    expect(adapter).toBeDefined();
    expect(google.tokenExchanges).toBe(1);
  });

  it("connect resolves false within connectTimeoutMs + 500 ms when the token exchange never answers", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    google.tokenHangs = true;
    const port = await freePort();
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      port,
      fetch: google.fetch,
    });
    vi.useFakeTimers();
    let result: boolean | undefined;

    const connecting = adapter.connect().then((ok) => {
      result = ok;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(501);
    vi.useRealTimers();
    await connecting;

    expect(result).toBe(false);
    expect(google.tokenExchanges).toBe(1);
    await expect(
      fetch(`http://127.0.0.1:${port}/google-chat`, { method: "POST" }),
    ).rejects.toThrow();
  });

  it("two overlapping connects share one token exchange and one listener", async () => {
    const google = scriptedGoogle();
    const port = await freePort();
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      port,
      fetch: google.fetch,
      now: () => NOW_MS,
    });
    open.push(adapter);

    const answers = await Promise.all([adapter.connect(), adapter.connect()]);

    expect(answers).toEqual([true, true]);
    expect(google.tokenExchanges).toBe(1);
  });

  it("a disconnect while the token exchange is pending leaves no listener", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    let releaseToken: () => void = () => undefined;
    const tokenHeld = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    let tokenAsked = false;
    const port = await freePort();
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      port,
      now: () => NOW_MS,
      fetch: async (input, init) => {
        if (input === TOKEN_URL) {
          tokenAsked = true;
          await tokenHeld;
        }
        return google.fetch(input, init);
      },
    });
    open.push(adapter);

    const connecting = adapter.connect();
    await until(() => tokenAsked, "the token request");
    await adapter.disconnect();
    releaseToken();

    expect(await connecting).toBe(false);
    await expect(
      fetch(`http://127.0.0.1:${port}/google-chat`, { method: "POST" }),
    ).rejects.toThrow();
    expect(
      (await adapter.sendMessage({ channel: { id: "spaces/AAA", type: "group" }, text: "hi" }))
        .error?.code,
    ).toBe("not_connected");
  });

  it("a second connect starts nothing new", async () => {
    const google = scriptedGoogle();
    const adapter = await connected(google);

    await expect(adapter.connect()).resolves.toBe(true);
    expect(google.tokenExchanges).toBe(1);
  });
});

describe("the token request", () => {
  it("asks for the chat.bot scope as the service account", async () => {
    const google = scriptedGoogle();
    await connected(google);

    const assertion = google.lastTokenForm?.get("assertion") ?? "";
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1] ?? "", "base64url").toString());

    expect(claims).toMatchObject({
      iss: SERVICE_ACCOUNT,
      scope: "https://www.googleapis.com/auth/chat.bot",
      aud: TOKEN_URL,
    });
    expect(claims.exp - claims.iat).toBe(3600);
  });
});
