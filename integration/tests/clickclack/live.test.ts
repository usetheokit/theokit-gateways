/**
 * ClickClack — live run with a real server and bot token (B-366).
 *
 * The adapter, run by `GatewayRunner`, opens the realtime socket and sends one message to the test
 * channel. Inbound needs someone to write, so it is not asserted; the run date, the channel and the
 * sent message id are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every ClickClack variable is set, and fails, naming what
 * is missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { ClickClackAdapter } from "@theokit/gateway-clickclack";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const CLICKCLACK = platformById("clickclack");

describeLive(
  CLICKCLACK,
  "connect and send",
  () => {
    it("opens the realtime socket and sends one message to the test channel", async () => {
      const channel = required("CLICKCLACK_TEST_CHANNEL_ID");
      const adapter = new ClickClackAdapter({
        baseUrl: required("CLICKCLACK_BASE_URL"),
        token: required("CLICKCLACK_TOKEN"),
        workspaceId: required("CLICKCLACK_WORKSPACE_ID"),
        botUserId: required("CLICKCLACK_BOT_USER_ID"),
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: channel, type: "group" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(
          `[clickclack live] ${new Date().toISOString()} channel=${channel} messageId=${result.messageId}`,
        );
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
