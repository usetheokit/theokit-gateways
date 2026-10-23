/**
 * Twitch — live run with a real bot account (B-363 AC-052).
 *
 * The adapter, run by `GatewayRunner`, validates the token, opens the EventSub socket, subscribes to
 * the test channel's chat and sends one message there. Inbound needs someone chatting in the
 * channel, so it is not asserted; the run date, the channel and the sent message id are printed as
 * the record. A message Twitch drops (follower-only mode for a bot that is not a moderator, plan Q2)
 * fails the suite with Twitch's own reason.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every Twitch variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { TwitchAdapter } from "@theokit/gateway-twitch";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const TWITCH = platformById("twitch");

describeLive(
  TWITCH,
  "connect, subscribe and send",
  () => {
    it("subscribes to the test channel's chat and sends one message there", async () => {
      const broadcaster = required("TWITCH_TEST_BROADCASTER_ID");
      const adapter = new TwitchAdapter({
        accessToken: required("TWITCH_ACCESS_TOKEN"),
        botUserId: required("TWITCH_BOT_USER_ID"),
        broadcasterUserIds: [broadcaster],
      });
      const runner = new GatewayRunner({ adapters: [adapter], handler: async () => undefined });
      try {
        await runner.start();
        const result = await adapter.sendMessage({
          channel: { id: broadcaster, type: "group" },
          text: runMarker(),
        });
        expect(result.ok, result.error?.message).toBe(true);
        console.log(
          `[twitch live] ${new Date().toISOString()} broadcaster=${broadcaster} messageId=${result.messageId}`,
        );
      } finally {
        await runner.stop();
      }
    }, 60_000);
  },
  { failWhenIncomplete: true },
);
