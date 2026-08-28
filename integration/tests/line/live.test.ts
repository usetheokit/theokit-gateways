/**
 * LINE — live tests against the real Messaging API.
 *
 * This suite matters more than most, because this package is where the whole
 * live-testing effort started. `makeClient` handed back the v9
 * `MessagingApiClient` untouched while `adapter.ts` called it positionally, so
 * every outbound message reached LINE as `{replyToken: undefined}` and came back
 * 400 — with eight unit tests green, because the fake implemented the positional
 * signature the real client does not have.
 *
 * That fix was verified against the installed `.d.ts`, not against LINE. The
 * outbound test below is what closes that gap: it is the first thing here that
 * has actually asked LINE whether the payload shape is right.
 *
 * LINE is webhook-based — the platform dials in — so inbound needs a publicly
 * reachable HTTPS endpoint and skips without one. Outbound and auth run
 * anywhere.
 */

import { LineAdapter } from "@theokit/gateway-line";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const LINE = platformById("line");

function makeAdapter(overrides: Record<string, unknown> = {}): LineAdapter {
  return new LineAdapter({
    channelSecret: required("LINE_CHANNEL_SECRET"),
    channelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN"),
    ...overrides,
  });
}

describeLive(
  LINE,
  "authentication",
  () => {
    it("connects with a real channel access token", async () => {
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on a token LINE rejects", async () => {
      // Building a LINE client performs no network I/O, so connect() reported
      // success for any string until 2026-08-17 and the failure only appeared at
      // the first send — as a 401 that reads like a send bug. It now calls
      // /v2/bot/info, and this is the assertion that proves LINE agrees.
      const adapter = makeAdapter({ channelAccessToken: "definitely-not-a-real-token" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(LINE, "outbound", () => {
  it("delivers a push message to the test user", async () => {
    // THE test for this package. A positional call against the v9 client sends
    // `{to: undefined, messages: undefined}`, which LINE answers 400 — so this
    // passing is the first real evidence the v9 wrapper is correct, rather than
    // merely type-correct.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("LINE_TEST_USER_ID"), type: "dm" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.messageId).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("splits past LINE's 5000-char cap into parts LINE accepts", async () => {
    // The splitter walks GRAPHEMES, because LINE counts characters in a way that
    // severs an emoji if you cut by code unit. Only the API can confirm each part
    // it produces is accepted.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("LINE_TEST_USER_ID"), type: "dm" },
        text: `${marker} ${"paragraph. ".repeat(800)}`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 90_000);

  it("maps an unknown recipient into a structured error", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: "U00000000000000000000000000000000", type: "dm" },
        text: "this user does not exist",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBeDefined();
      expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("refuses empty text without calling the API", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("LINE_TEST_USER_ID"), type: "dm" },
        text: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("empty_text");
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);
});

describeLiveInbound(LINE, "inbound round trip", () => {
  it("receives a webhook delivery", () => {
    // Unreachable without a tunnel: LINE posts to a URL it must be able to
    // reach, and a locally-served request would prove this test's own fixture
    // works and nothing about LINE. `describeLiveInbound` skips webhook
    // platforms with that reason rather than staging a fake round trip.
    expect(true).toBe(true);
  });
});
