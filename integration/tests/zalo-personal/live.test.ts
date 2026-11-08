/**
 * Zalo Personal — live run with a real, throwaway personal account (B-365).
 *
 * The adapter, run by `GatewayRunner`, logs in with the saved web session, starts the listener and
 * sends one message to the test thread. Inbound needs the peer to write, so it is not asserted; the
 * run date, the thread and the sent message id are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every Zalo variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { ZaloPersonalAdapter } from "@theokit/gateway-zalo-personal";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const ZALO = platformById("zalo-personal");

describeLive(
  ZALO,
  "log in, listen and send",
  () => {
    it("logs in with the saved session and sends one message to the test thread", async () => {
      const thread = required("ZALO_PERSONAL_TEST_THREAD_ID");
      const adapter = new ZaloPersonalAdapter({
        credentials: {
          cookie: JSON.parse(required("ZALO_PERSONAL_COOKIE")) as unknown,
          imei: required("ZALO_PERSONAL_IMEI"),
          userAgent: required("ZALO_PERSONAL_USER_AGENT"),
        },
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: thread, type: "dm" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(
          `[zalo_personal live] ${new Date().toISOString()} thread=${thread} messageId=${result.messageId}`,
        );
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
