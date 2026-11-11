/**
 * Yuanbao — live run with a real account.
 *
 * The adapter, run by `GatewayRunner`, exchanges the app secret for a token and sends one message to a user.
 * Inbound needs a public webhook, so it is not asserted; the run date and the user
 * are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every Yuanbao variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { YuanbaoAdapter } from "@theokit/gateway-yuanbao";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const YUANBAO = platformById("yuanbao");

describeLive(
  YUANBAO,
  "connect and send",
  () => {
    it("connects with the Secret and sends one message to the test user", async () => {
      const user = required("YUANBAO_TEST_USER");
      const adapter = new YuanbaoAdapter({
        appId: required("YUANBAO_APP_ID"),
        appSecret: required("YUANBAO_APP_SECRET"),
        callbackSecret: required("YUANBAO_CALLBACK_SECRET"),
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: user, type: "dm" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(`[yuanbao live] ${new Date().toISOString()} user=${user}`);
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
