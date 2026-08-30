/**
 * Discord — live tests against the real Discord API, over the gateway websocket.
 *
 * Discord is connection-based: discord.js opens a websocket and holds it, so
 * both directions run unattended with no public URL.
 *
 * The intent worth naming here is MESSAGE CONTENT. It is privileged, and when
 * it is off Discord does not error — it delivers events with `content` empty.
 * That is the silent failure EC-C exists for, and no fake can reproduce it,
 * because a fake has no opinion about what the platform withholds. The inbound
 * test below asserts the text arrives non-empty, which is the only way to catch
 * the intent being switched off in the developer portal months from now.
 */

import { DiscordAdapter } from "@theokit/gateway-discord";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const DISCORD = platformById("discord");

const USER_AGENT =
  "DiscordBot (https://github.com/usetheokit/theokit-gateways, 0.1) theokit-integration";

/** Post through the REST API directly, as a sender independent of the adapter. */
async function postAs(token: string, channelId: string, content: string) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
      // Discord sits behind Cloudflare, which answers 403 (error 1010) to a
      // request with no User-Agent. Worth pinning: the failure looks like a bad
      // token and is not one.
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ content }),
  });
  return { ok: res.ok, status: res.status, body: (await res.json()) as { id?: string } };
}

describeLive(
  DISCORD,
  "authentication",
  () => {
    it("connects to the real gateway with a valid bot token", async () => {
      const adapter = new DiscordAdapter({ token: required("DISCORD_BOT_TOKEN") });
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on a token Discord rejects", async () => {
      const adapter = new DiscordAdapter({
        token: "MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.notarealtoken",
      });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(DISCORD, "outbound", () => {
  it("delivers a message to the test channel and returns its id", async () => {
    const adapter = new DiscordAdapter({ token: required("DISCORD_BOT_TOKEN") });
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("DISCORD_TEST_CHANNEL_ID"), type: "group" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.messageId).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("splits past Discord's 2000-char cap into parts Discord accepts", async () => {
    // Discord's cap is 2000, not 4096 — a splitter tuned to the wrong platform
    // produces parts the API rejects with 50035, and only Discord says so.
    const adapter = new DiscordAdapter({ token: required("DISCORD_BOT_TOKEN") });
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("DISCORD_TEST_CHANNEL_ID"), type: "group" },
        text: `${marker} ${"paragraph.\n\n".repeat(400)}`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 90_000);

  it("maps a channel the bot cannot post to into a structured error", async () => {
    const adapter = new DiscordAdapter({ token: required("DISCORD_BOT_TOKEN") });
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: "000000000000000000", type: "group" },
        text: "this channel does not exist",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBeDefined();
      expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("refuses empty text without calling the API", async () => {
    const adapter = new DiscordAdapter({ token: required("DISCORD_BOT_TOKEN") });
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("DISCORD_TEST_CHANNEL_ID"), type: "group" },
        text: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("empty_text");
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);
});

describeLiveInbound(DISCORD, "inbound round trip", () => {
  it("receives a message over the gateway, WITH its content", async () => {
    // Two things are asserted, and the second is the point. That an event
    // arrives proves the websocket and the intents that carry message events.
    // That `text` is non-empty proves MESSAGE CONTENT specifically — turn that
    // privileged intent off in the portal and Discord keeps delivering events,
    // silently emptied (EC-C). A test that only counted events would stay green
    // through that outage.
    //
    // The sender must not be the bot itself: normalizeEvent drops
    // `msg.author.bot`. DISCORD_TEST_SENDER_TOKEN is a second bot in the same
    // server; without it there is no independent sender, so the suite says so.
    const senderToken = optional("DISCORD_TEST_SENDER_TOKEN");
    if (senderToken === undefined) {
      expect
        .soft(
          senderToken,
          "add a second bot as DISCORD_TEST_SENDER_TOKEN — see integration/README.md",
        )
        .toBeUndefined();
      return;
    }

    const adapter = new DiscordAdapter({ token: required("DISCORD_BOT_TOKEN") });
    const channelId = required("DISCORD_TEST_CHANNEL_ID");
    const marker = runMarker();
    const seen: string[] = [];

    try {
      adapter.onInbound(async (event) => {
        seen.push(event.text);
      });
      await adapter.connect();

      const posted = await postAs(senderToken, channelId, `${marker} inbound probe`);
      expect(posted.ok, `HTTP ${posted.status}`).toBe(true);

      const received = await waitFor(() => seen.find((t) => t.includes(marker)), {
        timeoutMs: 30_000,
        label: `an inbound message containing ${marker}`,
      });
      expect(received.length).toBeGreaterThan(marker.length);
    } finally {
      await adapter.disconnect();
    }
  }, 90_000);
});
