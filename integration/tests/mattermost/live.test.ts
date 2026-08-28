/**
 * Mattermost — live tests against a real server, booted for the run.
 *
 * Mattermost is self-hosted software, so a real server IS the platform, the same
 * way it is for Matrix. Nothing here needs a credential from anyone: the
 * bootstrap creates the instance, the accounts, the team and the channel, and
 * `mattermost:down` destroys all of it.
 *
 * What that does NOT cover is Mattermost Cloud's own configuration — an
 * enterprise instance with different permission defaults could behave
 * differently, and this suite would not know.
 *
 * The interesting half is inbound. Mattermost delivers over a WEBSOCKET the
 * adapter opens, so a round trip runs unattended, and the thing worth asserting
 * is that the socket survives long enough to carry a message posted after it
 * came up.
 */

import { MattermostAdapter } from "@theokit/gateway-mattermost";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const MATTERMOST = platformById("mattermost");

function makeAdapter(overrides: Record<string, unknown> = {}): MattermostAdapter {
  return new MattermostAdapter({
    baseUrl: required("MATTERMOST_BASE_URL"),
    accessToken: required("MATTERMOST_ACCESS_TOKEN"),
    // The channel exists for this and nothing else, so every message in it is
    // for the bot. The mention filter is already covered by the unit suite.
    requireMention: false,
    ...overrides,
  });
}

/** Post as the probe account — an identity that is not the bot. */
async function postAsProbe(channelId: string, message: string) {
  const res = await fetch(`${required("MATTERMOST_BASE_URL")}/api/v4/posts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${required("MATTERMOST_TEST_SENDER_TOKEN")}`,
    },
    body: JSON.stringify({ channel_id: channelId, message }),
  });
  return { ok: res.ok, status: res.status };
}

describeLive(
  MATTERMOST,
  "authentication",
  () => {
    it("connects to the real server with a valid personal access token", async () => {
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on a token the server rejects", async () => {
      // Worth having against a real server: this is the assertion that caught
      // MatrixAdapter reporting success for a rejected token, because its SDK
      // starts syncing asynchronously and never surfaces the 401 to connect().
      const adapter = makeAdapter({ accessToken: "not-a-real-token" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(MATTERMOST, "outbound", () => {
  it("delivers a message to the test channel and returns its post id", async () => {
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("MATTERMOST_TEST_CHANNEL_ID"), type: "group" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.messageId).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("splits past Mattermost's 16383-char cap into parts the server accepts", async () => {
    // Mattermost's limit is far higher than Slack's or Discord's, and it is
    // measured in RUNES rather than bytes. A splitter tuned to the wrong number
    // produces posts the API rejects, and only the server says which.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("MATTERMOST_TEST_CHANNEL_ID"), type: "group" },
        text: `${marker} ${"paragraph.\n\n".repeat(2000)}`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 90_000);

  it("maps a channel the bot is not in into a structured error", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: "0000000000000000000000000a", type: "group" },
        text: "this channel does not exist",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBeDefined();
      expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("refuses empty text without calling the server", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("MATTERMOST_TEST_CHANNEL_ID"), type: "group" },
        text: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("empty_text");
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);
});

describeLiveInbound(MATTERMOST, "inbound round trip", () => {
  it("receives, over the websocket, a message posted by the probe account", async () => {
    // The sender is a second account. Like every platform in this suite,
    // messages the bot posted itself are filtered before a handler sees them —
    // three platforms taught that lesson the hard way before this one.
    const senderToken = optional("MATTERMOST_TEST_SENDER_TOKEN");
    if (senderToken === undefined) {
      expect
        .soft(senderToken, "run `pnpm --filter @theokit/gateway-integration mattermost:up` first")
        .toBeUndefined();
      return;
    }

    const adapter = makeAdapter();
    const channelId = required("MATTERMOST_TEST_CHANNEL_ID");
    const marker = runMarker();
    const seen: string[] = [];

    try {
      adapter.onInbound(async (event) => {
        seen.push(event.text);
      });
      await adapter.connect();

      // Let the websocket finish its handshake, so what follows is genuinely
      // carried by the live socket rather than by a backfill.
      await new Promise((r) => setTimeout(r, 2_000));

      const posted = await postAsProbe(channelId, `${marker} inbound probe`);
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
