/**
 * WeChat Official Account — live run with a real account.
 *
 * The adapter, run by `GatewayRunner`, exchanges the AppSecret for a token and sends one message to a follower.
 * Inbound needs a public webhook, so it is not asserted; the run date and the user
 * are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every WeChat variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { WeChatAdapter } from "@theokit/gateway-wechat";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const WECHAT = platformById("wechat");

describeLive(
  WECHAT,
  "connect and send",
  () => {
    it("connects with the AppSecret and sends one message to the test user", async () => {
      const user = required("WECHAT_TEST_OPENID");
      const adapter = new WeChatAdapter({
        appId: required("WECHAT_APP_ID"),
        appSecret: required("WECHAT_APP_SECRET"),
        token: required("WECHAT_TOKEN"),
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: user, type: "dm" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(`[wechat live] ${new Date().toISOString()} user=${user}`);
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
