/**
 * Raft — live wake and reply with the real Raft CLI.
 *
 * `RAFT_CLI_PATH` is the logged-in Raft CLI and `RAFT_TEST_CONVERSATION` the conversation the
 * suite replies to. The suite starts the wake bridge, waits for someone to wake the agent from
 * Raft, then replies and prints the run date and the wake id as the record. It skips unless
 * `INTEGRATION_LIVE=1` and both variables are set, and fails naming what is missing when only
 * some are.
 */

import type { MessageEvent } from "@theokit/gateway";
import { RaftAdapter } from "@theokit/gateway-raft";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const RAFT = platformById("raft");

describeLive(
  RAFT,
  "wake and reply",
  () => {
    it("receives a wake from Raft and replies into the conversation", async () => {
      const conversation = required("RAFT_TEST_CONVERSATION");
      const adapter = new RaftAdapter({ command: required("RAFT_CLI_PATH") });
      const events: MessageEvent[] = [];
      adapter.onInbound(async (event) => {
        events.push(event);
      });
      try {
        expect(await adapter.connect(), "raft wake connect").toBe(true);
        const wake = await waitFor(() => events[0], {
          timeoutMs: 300_000,
          intervalMs: 1_000,
          label: "a wake from Raft",
        });
        expect(wake.platform).toBe("raft");
        const out = await adapter.sendMessage({
          channel: { id: conversation, type: "dm" },
          text: runMarker(),
        });
        expect(out.ok, JSON.stringify(out.error)).toBe(true);
        process.stdout.write(`[raft live] ${new Date().toISOString()} wake ${wake.id}\n`);
      } finally {
        await adapter.disconnect();
      }
    }, 600_000);
  },
  { failWhenIncomplete: true },
);
