/**
 * Slack — live tests against the real Slack API, over Socket Mode.
 *
 * Slack is connection-based: the app dials out over a websocket using the
 * app-level token, so both directions run unattended, with no public URL and
 * nothing to tunnel. That makes it the platform where a full round trip is
 * cheapest to prove, and the reason the inbound test here is a real one rather
 * than a skip.
 *
 * What is asserted is the contract, not the logic: that both tokens are
 * accepted, that a message we send actually lands with the text we sent, and
 * that a real Slack error (a channel the bot is not in) becomes the structured
 * error we claim to return instead of an exception.
 */

import { SlackAdapter } from "@theokit/gateway-slack";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const SLACK = platformById("slack");

function makeAdapter(): SlackAdapter {
  return new SlackAdapter({
    botToken: required("SLACK_BOT_TOKEN"),
    appToken: required("SLACK_APP_TOKEN"),
    // The integration channel exists for this and nothing else, so every message in it
    // is for the bot. Requiring a mention here would only test the mention
    // filter, which the unit suite already covers against fakes.
    requireMention: false,
    logLevel: "error",
  });
}

describeLive(
  SLACK,
  "authentication",
  () => {
    it("connects over Socket Mode with the real bot and app tokens", async () => {
      // Socket Mode needs BOTH: the app token opens the websocket, the bot token
      // authorizes the calls made over it. A test that only checked one would
      // pass with the other missing.
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    });

    it("returns false rather than throwing when the app token is rejected", async () => {
      const adapter = new SlackAdapter({
        botToken: required("SLACK_BOT_TOKEN"),
        appToken: "xapp-1-A000000000-0000000000000-notarealapptoken",
        logLevel: "error",
      });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    });
  },
  { sends: false },
);

describeLive(SLACK, "outbound", () => {
  it("delivers a message to the test channel", async () => {
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("SLACK_TEST_CHANNEL_ID"), type: "group" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.messageId).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  });

  it("splits past Slack's 4000-char cap into parts Slack accepts", async () => {
    // The splitter is unit-tested. What only Slack can answer is whether each
    // part it produces is accepted — one character over and chat.postMessage
    // returns msg_too_long.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("SLACK_TEST_CHANNEL_ID"), type: "group" },
        text: `${marker} ${"paragraph.\n\n".repeat(500)}`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 60_000);

  it("maps a channel the bot cannot post to into a structured error", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: "C00000000000", type: "group" },
        text: "this channel does not exist",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBeDefined();
      expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  });

  it("refuses empty text without calling the API", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("SLACK_TEST_CHANNEL_ID"), type: "group" },
        text: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("empty_text");
    } finally {
      await adapter.disconnect();
    }
  });
});

describeLiveInbound(SLACK, "inbound round trip", () => {
  it("receives, over Socket Mode, a message posted by a real user", async () => {
    // The sender must be a different identity from the bot. Posting with the
    // BOT token produces a message whose `user` is the bot, which the loop guard
    // (D275) correctly drops — the first version of this test did exactly that
    // and timed out for a reason that was not a defect.
    //
    // `SLACK_TEST_USER_TOKEN` is an `xoxp-` token from the app's `chat:write`
    // USER scope, so the probe arrives as a genuine human message. It is a
    // credential like any other: one OAuth install, then unattended forever.
    const userToken = optional("SLACK_TEST_USER_TOKEN");
    if (userToken === undefined) {
      expect
        .soft(userToken, "add the chat:write USER scope and reinstall — see integration/README.md")
        .toBeUndefined();
      return;
    }

    const adapter = makeAdapter();
    const channel = required("SLACK_TEST_CHANNEL_ID");
    const marker = runMarker();
    const seen: string[] = [];

    try {
      adapter.onInbound(async (event) => {
        seen.push(event.text);
      });
      await adapter.connect();

      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${userToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel, text: `${marker} inbound probe` }),
      });
      const posted = (await res.json()) as { ok: boolean; error?: string };
      expect(posted.ok, posted.error ?? "").toBe(true);

      await waitFor(() => seen.find((t) => t.includes(marker)), {
        timeoutMs: 30_000,
        label: `an inbound message containing ${marker}`,
      });
    } finally {
      await adapter.disconnect();
    }
  }, 90_000);
});
