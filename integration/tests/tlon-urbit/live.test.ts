/**
 * Tlon/Urbit — live round trip between two real ships (B-362 AC-042).
 *
 * A peer ship, driven by a second `TlonUrbitAdapter`, sends the bot a DM; the bot's adapter, run by
 * `GatewayRunner`, answers it; the peer receives the answer. Both channels are fresh, so the suite
 * also fails when either delivers an essay sent before the run started (the plan's Hypothesis that a
 * new `/v3` subscription carries only new events). The run date and both texts are printed as the
 * record of the run.
 *
 * It skips unless `INTEGRATION_LIVE=1` and every Tlon variable is set, and fails, naming what is
 * missing, when only some are.
 */

import { GatewayRunner, type MessageEvent } from "@theokit/gateway";
import { TlonUrbitAdapter } from "@theokit/gateway-tlon-urbit";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const TLON = platformById("tlon-urbit");

describeLive(
  TLON,
  "receive a DM and answer it",
  () => {
    it("answers a DM from a peer ship, and delivers nothing older than the run", async () => {
      const runStart = Date.now();
      const marker = runMarker();
      const stale: MessageEvent[] = [];
      const noteStale = (event: MessageEvent): void => {
        if (event.platform === "tlon_urbit" && event.tlon_urbit.sent < runStart) stale.push(event);
      };
      const bot = new TlonUrbitAdapter({
        shipUrl: required("TLON_SHIP_URL"),
        ship: required("TLON_SHIP"),
        code: required("TLON_CODE"),
      });
      const peer = new TlonUrbitAdapter({
        shipUrl: required("TLON_PEER_SHIP_URL"),
        ship: required("TLON_PEER_SHIP"),
        code: required("TLON_PEER_CODE"),
      });
      const answers: string[] = [];
      peer.onInbound(async (event) => {
        noteStale(event);
        answers.push(event.text);
      });
      const runner = new GatewayRunner({
        adapters: [bot],
        handler: async (event, ctx) => {
          noteStale(event);
          if (event.text === marker) await ctx.reply(`answer to ${marker}`);
        },
      });
      try {
        await runner.start();
        expect(await peer.connect()).toBe(true);
        const sent = await peer.sendMessage({
          channel: { id: required("TLON_SHIP"), type: "dm" },
          text: marker,
        });
        expect(sent.ok, sent.error?.message).toBe(true);
        const answer = await waitFor(() => answers.find((text) => text === `answer to ${marker}`), {
          timeoutMs: 60_000,
          intervalMs: 500,
          label: "the bot's answer on the peer ship",
        });
        console.log(
          `[tlon-urbit live] ${new Date().toISOString()} sent=${marker} answered=${answer}`,
        );
        expect(stale, "essays sent before the run that a fresh channel delivered").toEqual([]);
      } finally {
        await peer.disconnect();
        await runner.stop();
      }
    }, 90_000);
  },
  { failWhenIncomplete: true },
);
