/**
 * QQ Bot — live connect, receive and reply with a real bot.
 *
 * `QQ_APP_ID` and `QQ_APP_SECRET` are the bot's credentials; `QQ_TEST_OPENID` is the user_openid
 * of a QQ user who has messaged the bot. The suite connects to the gateway, waits for a direct
 * message, replies to it through the real API and prints the run date and the message id as the
 * record. It skips unless `INTEGRATION_LIVE=1` and the variables are set, and fails naming what
 * is missing when only some are.
 */

import type { MessageEvent } from "@theokit/gateway";
import { QQAdapter } from "@theokit/gateway-qq";
import { expect, it } from "vitest";

import { required } from "../../src/credentials.js";
import { describeLive, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const QQ = platformById("qq");

describeLive(
  QQ,
  "receive and reply",
  () => {
    it("receives a direct message and replies to it", async () => {
      const openid = required("QQ_TEST_OPENID");
      const adapter = new QQAdapter({
        appId: required("QQ_APP_ID"),
        clientSecret: required("QQ_APP_SECRET"),
      });
      const events: MessageEvent[] = [];
      adapter.onInbound(async (event) => {
        events.push(event);
      });
      try {
        expect(await adapter.connect(), "qq gateway connect").toBe(true);
        const dm = await waitFor(
          () => events.find((e) => e.platform === "qq" && e.sender.id === openid),
          { timeoutMs: 300_000, intervalMs: 1_000, label: "a direct message from QQ_TEST_OPENID" },
        );
        const out = await adapter.sendMessage({
          channel: dm.channel,
          text: `theokit gateway-qq live check ${new Date().toISOString()}`,
        });
        expect(out.ok, JSON.stringify(out.error)).toBe(true);
        process.stdout.write(`[qq live] ${new Date().toISOString()} message ${out.messageId}\n`);
      } finally {
        await adapter.disconnect();
      }
    }, 600_000);
  },
  { failWhenIncomplete: true },
);
