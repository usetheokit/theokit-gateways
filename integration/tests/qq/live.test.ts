/**
 * QQ — live run with a real account.
 *
 * The adapter, run by `GatewayRunner`, exchanges the AppSecret for a token and sends one message to a user.
 * Inbound needs a public webhook, so it is not asserted; the run date and the user
 * are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every QQ variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { QQAdapter } from "@theokit/gateway-qq";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const QQ = platformById("qq");

describeLive(
  QQ,
  "connect and send",
  () => {
    it("connects with the Secret and sends one message to the test user", async () => {
      const user = required("QQ_TEST_USER");
      const adapter = new QQAdapter({
        appId: required("QQ_APP_ID"),
        clientSecret: required("QQ_CLIENT_SECRET"),
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: user, type: "dm" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(`[qq live] ${new Date().toISOString()} user=${user}`);
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
