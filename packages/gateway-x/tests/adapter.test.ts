import type { MessageEvent, XMessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import type { XAdapterOptions, XFetch, XTweet } from "../src/index.js";
import { XAdapter } from "../src/index.js";

const BOT = "100";

interface Call {
  method: string;
  url: string;
  body: string | undefined;
  auth: string | undefined;
}

function fake(script: {
  mentions: () => { data?: XTweet[]; includes?: unknown; meta?: { newest_id?: string } };
  tweets?: Record<string, XTweet>;
}) {
  const calls: Call[] = [];
  const refreshed: string[] = [];
  let posted = 0;
  const json = (status: number, body: unknown) => ({
    status,
    text: async () => JSON.stringify(body),
  });
  const route = (url: string, method: string) => {
    if (url.endsWith("/2/oauth2/token")) {
      return json(200, {
        access_token: `at${refreshed.length}`,
        refresh_token: `rt${refreshed.length}`,
        expires_in: 7200,
      });
    }
    if (url.includes("/mentions")) return json(200, script.mentions());
    if (method === "POST") return json(201, { data: { id: `reply${++posted}` } });
    const tweet = script.tweets?.[url.split("/2/tweets/")[1]?.split("?")[0] ?? ""];
    return json(tweet === undefined ? 404 : 200, { data: tweet, title: "Not Found" });
  };
  const fetchFake: XFetch = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body, auth: init.headers.Authorization });
    if (url.endsWith("/2/oauth2/token")) refreshed.push(init.body ?? "");
    return route(url, init.method);
  };
  return { fetchFake, calls, refreshed };
}

function make(fetchFake: XFetch, extra: Partial<XAdapterOptions> = {}) {
  const adapter = new XAdapter({
    userId: BOT,
    username: "@theobot",
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt0",
    allowFrom: ["@Alice"],
    pollIntervalMs: 0,
    fetch: fetchFake,
    ...extra,
  });
  const events: MessageEvent[] = [];
  adapter.onInbound(async (e) => void events.push(e));
  return { adapter, events };
}

const mention = (over: Partial<XTweet> & { id: string }): XTweet => ({
  text: "@theobot hello",
  author_id: "1",
  conversation_id: "conv",
  created_at: "2026-11-10T10:00:00.000Z",
  ...over,
});

const users = [
  { id: "1", username: "alice" },
  { id: "2", username: "mallory" },
];

describe("XAdapter", () => {
  it("delivers an allowlisted mention with its thread and quote, and replies publicly", async () => {
    let round = 0;
    const { fetchFake, calls } = fake({
      mentions: () =>
        round++ === 0
          ? { meta: { newest_id: "5" } }
          : {
              data: [
                mention({
                  id: "9",
                  referenced_tweets: [
                    { type: "replied_to", id: "8" },
                    { type: "quoted", id: "7" },
                  ],
                }),
              ],
              includes: {
                users,
                tweets: [
                  {
                    id: "8",
                    text: "parent",
                    author_id: "2",
                    referenced_tweets: [{ type: "replied_to", id: "6" }],
                  },
                  { id: "7", text: "quoted one", author_id: "2" },
                ],
              },
              meta: { newest_id: "9" },
            },
      tweets: { "6": { id: "6", text: "root", author_id: "1" } },
    });
    const { adapter, events } = make(fetchFake);
    expect(await adapter.connect()).toBe(true);
    expect(await adapter.poll()).toBe(1);

    const event = events[0] as XMessageEvent;
    expect(event.channel).toEqual({ id: "conv", type: "group" });
    expect(event.sender).toEqual({ id: "1", username: "alice" });
    expect(event.text).toBe("hello");
    expect(event.x.thread.map((t) => t.text)).toEqual(["root", "parent"]);
    expect(event.x.thread[1]?.username).toBe("mallory");
    expect(event.x.quoted?.text).toBe("quoted one");
    expect(event.x.guest).toBe(false);

    const result = await adapter.sendMessage({ channel: event.channel, text: "hi there" });
    expect(result).toEqual({ ok: true, messageId: "reply1" });
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/2/tweets"));
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      text: "hi there",
      reply: { in_reply_to_tweet_id: "9" },
    });
    expect(post?.auth).toBe("Bearer at1");
  });

  it("starts after the existing backlog and does not repeat a mention", async () => {
    let round = 0;
    const { fetchFake, calls } = fake({
      mentions: () =>
        round++ === 0
          ? { data: [mention({ id: "3" })], includes: { users }, meta: { newest_id: "3" } }
          : { data: [mention({ id: "4" })], includes: { users }, meta: { newest_id: "4" } },
    });
    const { adapter, events } = make(fetchFake);
    await adapter.connect();
    await adapter.poll();
    await adapter.poll();
    expect(events.map((e) => e.id)).toEqual(["4"]);
    expect(calls.filter((c) => c.url.includes("/mentions"))[1]?.url).toContain("since_id=3");
  });

  it("gives a non-allowlisted author no event and no reply", async () => {
    let round = 0;
    const { fetchFake, calls } = fake({
      mentions: () =>
        round++ === 0
          ? { meta: { newest_id: "1" } }
          : {
              data: [mention({ id: "2", author_id: "2" })],
              includes: { users },
              meta: { newest_id: "2" },
            },
    });
    const { adapter, events } = make(fetchFake);
    await adapter.connect();
    expect(await adapter.poll()).toBe(0);
    expect(events).toEqual([]);
    const result = await adapter.sendMessage({ channel: { id: "conv", type: "group" }, text: "x" });
    expect(result.error?.code).toBe("invalid_reply_target");
    expect(calls.some((c) => c.url.endsWith("/2/tweets"))).toBe(false);
  });

  it("guest mode answers other authors up to a daily cap, then resets next UTC day", async () => {
    let round = 0;
    let clock = Date.parse("2026-11-10T10:00:00Z");
    const { fetchFake } = fake({
      mentions: () =>
        round++ === 0
          ? { meta: { newest_id: "1" } }
          : {
              data: [mention({ id: String(round * 10), author_id: "2" })],
              includes: { users },
              meta: { newest_id: String(round * 10) },
            },
    });
    const { adapter, events } = make(fetchFake, { guest: { dailyLimit: 2 }, now: () => clock });
    await adapter.connect();
    expect(await adapter.poll()).toBe(1);
    expect(await adapter.poll()).toBe(1);
    expect(await adapter.poll()).toBe(0);
    expect((events[0] as XMessageEvent).x.guest).toBe(true);
    clock += 24 * 3600 * 1000;
    expect(await adapter.poll()).toBe(1);
  });

  it("splits a long reply into a chain and reports the rotated refresh token", async () => {
    let round = 0;
    const rotated: string[] = [];
    const { fetchFake, calls } = fake({
      mentions: () =>
        round++ === 0
          ? { meta: { newest_id: "1" } }
          : { data: [mention({ id: "2" })], includes: { users }, meta: { newest_id: "2" } },
    });
    const { adapter } = make(fetchFake, { onRefreshToken: (t) => void rotated.push(t) });
    await adapter.connect();
    await adapter.poll();
    const result = await adapter.sendMessage({
      channel: { id: "conv", type: "group" },
      text: "a".repeat(300),
    });
    expect(result.messageId).toBe("reply2");
    const bodies = calls
      .filter((c) => c.url.endsWith("/2/tweets") && c.method === "POST")
      .map((c) => JSON.parse(c.body ?? "{}") as { reply: { in_reply_to_tweet_id: string } });
    expect(bodies.map((b) => b.reply.in_reply_to_tweet_id)).toEqual(["2", "reply1"]);
    expect(rotated).toEqual(["rt1"]);
  });

  it("refuses attachments, empty text and an unconnected send", async () => {
    const { fetchFake } = fake({ mentions: () => ({}) });
    const { adapter } = make(fetchFake);
    const channel = { id: "conv", type: "group" as const };
    expect((await adapter.sendMessage({ channel, text: "x" })).error?.code).toBe("not_connected");
    expect((await adapter.sendMessage({ channel, text: "" })).error?.code).toBe("empty_text");
    expect(
      (
        await adapter.sendMessage({
          channel,
          text: "x",
          attachments: [{ kind: "image", data: new Uint8Array(1), mimeType: "image/png" }] as never,
        })
      ).error?.code,
    ).toBe("attachments_unsupported");
  });

  it("answers false from connect when the token refresh fails, and rejects missing options", async () => {
    const { adapter } = make(async () => ({
      status: 401,
      text: async () => '{"error":"invalid_grant"}',
    }));
    expect(await adapter.connect()).toBe(false);
    expect(() => new XAdapter({ allowFrom: [] } as unknown as XAdapterOptions)).toThrow(/userId/);
  });
});
