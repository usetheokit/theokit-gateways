/**
 * X — live run with a real developer app and bot account.
 *
 * The adapter, run by `GatewayRunner`, refreshes the bot's OAuth 2.0 token, then waits up to 120 s
 * for the allowed account to mention the bot, and replies through the runner. The mention must
 * arrive with its thread, and the reply must post as a public reply; the run date, the mention id
 * and the reply id are printed as the record.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every X variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { XAdapter } from "@theokit/gateway-x";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const X = platformById("x");

describeLive(
  X,
  "mention and reply",
  () => {
    it("delivers a mention from the allowed account and posts the reply publicly", async () => {
      const adapter = new XAdapter({
        userId: required("X_USER_ID"),
        username: required("X_USERNAME"),
        clientId: required("X_CLIENT_ID"),
        clientSecret: required("X_CLIENT_SECRET"),
        refreshToken: required("X_REFRESH_TOKEN"),
        allowFrom: [required("X_ALLOWED_USERNAME")],
        pollIntervalMs: 5_000,
      });
      let onReply: (id: string) => void = () => undefined;
      const replied = new Promise<string>((resolve) => (onReply = resolve));
      let result: { ok: boolean; messageId?: string; error?: { message: string } } | undefined;
      const runner = new GatewayRunner({
        adapters: [adapter],
        handler: async (event, ctx) => {
          result = await ctx.reply(runMarker());
          onReply(event.id);
        },
      });
      try {
        await runner.start();
        const mention = await Promise.race([
          replied,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("no mention within 120 s")), 120_000),
          ),
        ]);
        expect(result?.ok, result?.error?.message).toBe(true);
        console.log(
          `[x live] ${new Date().toISOString()} mention=${mention} reply=${result?.messageId}`,
        );
      } finally {
        await runner.stop();
      }
    }, 180_000);
  },
  { failWhenIncomplete: true },
);
