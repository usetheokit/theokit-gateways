/**
 * Feishu/Lark — live run against a real custom app (B-360 AC-022).
 *
 * The adapter, run by `GatewayRunner`, fetches a tenant token, opens the long connection and sends
 * one message to `LARK_TEST_CHAT_ID`. Inbound needs a person writing in that chat, so it is not
 * asserted here; the suite prints the run date, the domain and the sent message id as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every Lark variable is set, and it fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { FeishuLarkAdapter } from "@theokit/gateway-feishu-lark";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const LARK = platformById("feishu-lark");

describeLive(
  LARK,
  "connect and send",
  () => {
    it("opens the long connection and sends one message to the test chat", async () => {
      const domain = required("LARK_DOMAIN") === "lark" ? "lark" : "feishu";
      const adapter = new FeishuLarkAdapter({
        appId: required("LARK_APP_ID"),
        appSecret: required("LARK_APP_SECRET"),
        domain,
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: required("LARK_TEST_CHAT_ID"), type: "group" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(
          `[feishu-lark live] ${new Date().toISOString()} domain=${domain} messageId=${result.messageId}`,
        );
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
