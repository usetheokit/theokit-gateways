/**
 * Matrix — live tests against a real homeserver, booted for the run.
 *
 * This is the only platform here that needs no credential from anyone. There is
 * no hosted account to create: matrix.org answers registration with "Only
 * m.login.application_service registrations are allowed", and the other public
 * homeservers have closed registration too. So the suite brings its own server.
 *
 * That is not a downgrade from testing "the real thing". Matrix is federated by
 * design and most deployments are self-hosted, so a real homeserver IS the
 * platform, in a way that a local stand-in for Slack could never be. What it
 * does NOT cover is federation between servers, or matrix.org's own quirks — and
 * that limit is worth stating rather than letting a green tick imply otherwise.
 *
 * Boot it with `pnpm --filter @theokit/gateway-integration matrix:up` before running,
 * and `matrix:down` after. Without it these skip on the missing MATRIX_* vars,
 * like any other unconfigured platform.
 */

import { MatrixAdapter } from "@theokit/gateway-matrix";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const MATRIX = platformById("matrix");

function makeAdapter(overrides: Record<string, unknown> = {}): MatrixAdapter {
  return new MatrixAdapter({
    homeserverUrl: required("MATRIX_HOMESERVER_URL"),
    accessToken: required("MATRIX_ACCESS_TOKEN"),
    userId: required("MATRIX_USER_ID"),
    ...overrides,
  });
}

/** Send as the probe account — an identity that is not the bot. */
async function postAsProbe(roomId: string, body: string) {
  const token = required("MATRIX_TEST_SENDER_TOKEN");
  const url = `${required("MATRIX_HOMESERVER_URL")}/_matrix/client/v3/rooms/${encodeURIComponent(
    roomId,
  )}/send/m.room.message/${encodeURIComponent(`probe-${Date.now()}`)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ msgtype: "m.text", body }),
  });
  return { ok: res.ok, status: res.status };
}

describeLive(
  MATRIX,
  "authentication",
  () => {
    it("connects to the real homeserver with a valid access token", async () => {
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on a token the server rejects", async () => {
      const adapter = makeAdapter({ accessToken: "syt_not_a_real_token_at_all" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(MATRIX, "outbound", () => {
  it("delivers a message to the test room and returns its event id", async () => {
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("MATRIX_TEST_ROOM_ID"), type: "group" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.messageId).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("maps a room the bot is not in into a structured error", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: "!nonexistent:localhost", type: "group" },
        text: "this room does not exist",
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
        channel: { id: required("MATRIX_TEST_ROOM_ID"), type: "group" },
        text: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("empty_text");
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);
});

describeLiveInbound(MATRIX, "inbound round trip", () => {
  it("receives, over sync, a message sent by the probe account", async () => {
    // The sender is a second registered account, not the bot: like every other
    // platform in this suite, a message the bot sent itself is filtered out
    // before a handler sees it.
    //
    // This also exercises EC-3, the freshness window. The room already has
    // history from the bootstrap, and the adapter must ignore that backlog on
    // initial sync while still delivering what arrives after — a distinction a
    // fake sync stream cannot pose, because a fake replays only what the test
    // hands it.
    const senderToken = optional("MATRIX_TEST_SENDER_TOKEN");
    if (senderToken === undefined) {
      expect
        .soft(senderToken, "run `pnpm --filter @theokit/gateway-integration matrix:up` first")
        .toBeUndefined();
      return;
    }

    const adapter = makeAdapter();
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    const seen: string[] = [];

    try {
      adapter.onInbound(async (event) => {
        seen.push(event.text);
      });
      await adapter.connect();

      // Let the initial sync settle, so what follows is a genuinely new event
      // rather than backlog the freshness window might have let through.
      await new Promise((r) => setTimeout(r, 2_000));

      const posted = await postAsProbe(roomId, `${marker} inbound probe`);
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

  it("does not replay history older than the freshness window", async () => {
    // EC-3 in the other direction: an adapter that dispatched backlog on connect
    // would flood the agent with old traffic on every restart.
    //
    // The window matters to how this is written. It defaults to 60s, so messages
    // this run just sent are legitimately FRESH and SHOULD arrive — the first
    // version of this test called them "backlog", asserted an empty array, and
    // failed against correct behaviour. Squeezing the window to 1ms makes
    // everything already in the room old by definition, which is the condition
    // actually under test.
    const adapter = makeAdapter({ freshnessWindowMs: 1 });
    const seen: string[] = [];
    try {
      adapter.onInbound(async (event) => {
        seen.push(event.text);
      });
      await adapter.connect();
      await new Promise((r) => setTimeout(r, 5_000));
      expect(seen).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  }, 60_000);
});
