import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextcloudTalkAdapter, verifyTalkSignature } from "../src/index.js";
import {
  BASE_URL,
  CREATE_BODY,
  freePort,
  freshRandom,
  REPLY_BODY,
  SECRET,
  scriptedTalk,
  signedHeaders,
  talkSignature,
} from "./fixtures.js";

const open: NextcloudTalkAdapter[] = [];

/** A connected adapter on a free port, and every event its handler received. */
async function connected(): Promise<{
  adapter: NextcloudTalkAdapter;
  events: MessageEvent[];
  port: number;
}> {
  const port = await freePort();
  const adapter = new NextcloudTalkAdapter({
    baseUrl: BASE_URL,
    secret: SECRET,
    port,
    fetch: scriptedTalk().fetch,
  });
  open.push(adapter);
  expect(await adapter.connect()).toBe(true);
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  return { adapter, events, port };
}

/** Let a handler started after the answer run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const adapter of open.splice(0)) await adapter.disconnect();
});

describe("verifyTalkSignature", () => {
  const body = JSON.stringify(CREATE_BODY);

  it("accepts the hex HMAC of random plus body", () => {
    const random = freshRandom();

    expect(verifyTalkSignature(SECRET, random, body, talkSignature(random, body))).toBe(true);
  });

  it("refuses a signature of a different length without comparing", () => {
    const random = freshRandom();

    expect(verifyTalkSignature(SECRET, random, body, talkSignature(random, body).slice(2))).toBe(
      false,
    );
  });

  it("refuses a signature made with another secret", () => {
    const random = freshRandom();

    expect(
      verifyTalkSignature(SECRET, random, body, talkSignature(random, body, "another-secret")),
    ).toBe(false);
  });

  it("accepts the same signature written in uppercase hex", () => {
    const random = freshRandom();

    expect(
      verifyTalkSignature(SECRET, random, body, talkSignature(random, body).toUpperCase()),
    ).toBe(true);
  });

  it("refuses an empty random or an empty signature", () => {
    const random = freshRandom();
    const signature = talkSignature(random, body);

    expect(verifyTalkSignature(SECRET, "", body, signature)).toBe(false);
    expect(verifyTalkSignature(SECRET, random, body, "")).toBe(false);
  });
});

describe("the webhook refuses what Talk did not sign", () => {
  it("accepts a body signed over random plus body", async () => {
    const { adapter, events } = await connected();
    const rawBody = JSON.stringify(CREATE_BODY);

    const answer = await adapter.handleRequest(signedHeaders(rawBody), rawBody);
    await settle();

    expect(answer.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it("refuses the same body signed over the body alone", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, events } = await connected();
    const rawBody = JSON.stringify(CREATE_BODY);
    const random = freshRandom();
    // The LINE shape: the signature covers the body and nothing else.
    const signature = talkSignature("", rawBody);

    const answer = await adapter.handleRequest({ random, signature }, rawBody);
    await settle();

    expect(answer.status).toBe(401);
    expect(events).toHaveLength(0);
  });

  it.each([
    ["missing random", (raw: string) => ({ signature: signedHeaders(raw).signature }), undefined],
    ["missing signature", (_raw: string) => ({ random: freshRandom() }), undefined],
    ["tampered body", (raw: string) => signedHeaders(raw), JSON.stringify(REPLY_BODY)],
  ] as const)(
    "refuses a request with a %s and calls no handler",
    async (_name, headersFor, sent) => {
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const { adapter, events } = await connected();
      const signedBody = JSON.stringify(CREATE_BODY);

      const answer = await adapter.handleRequest(headersFor(signedBody), sent ?? signedBody);
      await settle();

      expect(answer.status).toBe(401);
      expect(events).toHaveLength(0);
    },
  );
});

describe("the route on a real port", () => {
  async function post(port: number, rawBody: string, headers: Record<string, string>) {
    return fetch(`http://127.0.0.1:${port}/nextcloud-talk`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: rawBody,
    });
  }

  function talkHeaders(rawBody: string): Record<string, string> {
    const { random, signature } = signedHeaders(rawBody);
    return { "x-nextcloud-talk-random": random, "x-nextcloud-talk-signature": signature };
  }

  it("answers 413 to a body over 1 MiB and calls no handler", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { events, port } = await connected();
    const rawBody = "x".repeat(1024 * 1024 + 1);

    const answer = await post(port, rawBody, talkHeaders(rawBody));
    await settle();

    expect(answer.status).toBe(413);
    expect(events).toHaveLength(0);
  });

  it("answers the 413 as JSON with no stack trace", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { port } = await connected();
    const rawBody = "x".repeat(1024 * 1024 + 1);

    const answer = await post(port, rawBody, talkHeaders(rawBody));

    expect(answer.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await answer.text()).toBe('{"error":"request body too large"}');
  });

  it("verifies a body with non-ASCII text over the real socket", async () => {
    const { events, port } = await connected();
    const body = {
      ...CREATE_BODY,
      object: { ...CREATE_BODY.object, content: JSON.stringify({ message: "olá 😀 ação" }) },
    };
    const rawBody = JSON.stringify(body);

    const answer = await post(port, rawBody, talkHeaders(rawBody));
    await settle();

    expect(answer.status).toBe(200);
    expect(events.map((event) => event.text)).toEqual(["olá 😀 ação"]);
  });

  it("two verified POSTs at once each reach the handler once, a tampered third never does", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { events, port } = await connected();
    const first = JSON.stringify(CREATE_BODY);
    const second = JSON.stringify(REPLY_BODY);
    const tamperedHeaders = talkHeaders(first);

    const answers = await Promise.all([
      post(port, first, talkHeaders(first)),
      post(port, second, talkHeaders(second)),
      post(port, second, tamperedHeaders),
    ]);
    await settle();

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 401]);
    expect(events.map((event) => event.id).sort()).toEqual(["2", "6"]);
  });
});
