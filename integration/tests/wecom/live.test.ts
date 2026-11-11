/**
 * WeCom — live run with a real account.
 *
 * The adapter, run by `GatewayRunner`, exchanges the Secret for a token and sends one message to a follower.
 * Inbound needs a public webhook, so it is not asserted; the run date and the user
 * are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every WeCom variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { WeComAdapter } from "@theokit/gateway-wecom";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const WECOM = platformById("wecom");

describeLive(
  WECOM,
  "connect and send",
  () => {
    it("connects with the Secret and sends one message to the test user", async () => {
      const user = required("WECOM_TEST_USER");
      const adapter = new WeComAdapter({
        corpId: required("WECOM_CORP_ID"),
        corpSecret: required("WECOM_CORP_SECRET"),
        agentId: required("WECOM_AGENT_ID"),
        token: required("WECOM_TOKEN"),
        encodingAesKey: required("WECOM_ENCODING_AES_KEY"),
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: user, type: "dm" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(`[wecom live] ${new Date().toISOString()} user=${user}`);
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
