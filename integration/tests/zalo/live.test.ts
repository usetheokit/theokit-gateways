/**
 * Zalo Official Account — live run with a real OA (B-364).
 *
 * The adapter, run by `GatewayRunner`, checks the access token and sends one message to a follower.
 * Inbound needs a public webhook, so it is not asserted; the run date, the user and the message id
 * are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every Zalo variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { ZaloAdapter } from "@theokit/gateway-zalo";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const ZALO = platformById("zalo");

describeLive(
  ZALO,
  "connect and send",
  () => {
    it("connects with the token and sends one message to the test user", async () => {
      const user = required("ZALO_TEST_USER_ID");
      const adapter = new ZaloAdapter({
        appId: required("ZALO_APP_ID"),
        oaSecretKey: required("ZALO_OA_SECRET_KEY"),
        accessToken: required("ZALO_OA_ACCESS_TOKEN"),
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: user, type: "dm" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(
          `[zalo live] ${new Date().toISOString()} user=${user} messageId=${result.messageId}`,
        );
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
