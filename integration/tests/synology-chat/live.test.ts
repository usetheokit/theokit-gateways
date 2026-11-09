/**
 * Synology Chat — live run against a real NAS (B-361 AC-032, FR-034).
 *
 * The adapter, run by `GatewayRunner` on a caller's Express app listening on port 3000, proves the
 * Incoming URL with `user_list`, sends one message to `SYNOLOGY_CHAT_TEST_USER_ID`, then listens for
 * 30 seconds. Every callback is counted by `post_id`, with the content type it arrived in (plan Q3),
 * and the suite fails if any callback carries the bot's own reply: that would make the bot answer
 * itself. The counts are printed as the record of the run.
 *
 * Inbound needs the NAS to reach this machine's port 3000 at the bot's Outgoing URL. It skips unless
 * `INTEGRATION_LIVE=1` and every Synology variable is set, and fails, naming what is missing, when
 * only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { SynologyChatAdapter } from "@theokit/gateway-synology-chat";
import express from "express";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const SYNOLOGY = platformById("synology-chat");
const LISTEN_PORT = 3000;
/**
 * How long the suite listens after its send. It asserts an absence (no callback for the bot's own
 * reply), which has no condition to wait for, so the window is fixed; 30 s covers the NAS's
 * outgoing-webhook delivery, which arrives within seconds when it arrives at all.
 */
const LISTEN_MS = 30_000;

describeLive(
  SYNOLOGY,
  "send, then count callbacks",
  () => {
    it(
      "sends one message and receives no callback for the bot's own reply",
      async () => {
        const marker = runMarker();
        const app = express();
        const contentTypes = new Map<string, number>();
        app.use((req, _res, next) => {
          const type = req.headers["content-type"] ?? "none";
          contentTypes.set(type, (contentTypes.get(type) ?? 0) + 1);
          next();
        });
        const adapter = new SynologyChatAdapter({
          botToken: required("SYNOLOGY_CHAT_BOT_TOKEN"),
          incomingUrl: required("SYNOLOGY_CHAT_INCOMING_URL"),
          app,
        });
        const callbacks = new Map<string, number>();
        const echoes: string[] = [];
        const runner = new GatewayRunner({
          adapters: [adapter],
          handler: async (event) => {
            if (event.platform !== "synology_chat") return;
            const key = event.synology_chat.postId || "(none)";
            callbacks.set(key, (callbacks.get(key) ?? 0) + 1);
            if (event.text === marker) echoes.push(key);
          },
        });
        const server = app.listen(LISTEN_PORT);
        try {
          await runner.start();
          const result = await adapter.sendMessage({
            channel: { id: required("SYNOLOGY_CHAT_TEST_USER_ID"), type: "dm" },
            text: marker,
          });
          expect(result.ok, result.error?.message).toBe(true);
          await new Promise((resolve) => setTimeout(resolve, LISTEN_MS));
          console.log(
            `[synology-chat live] ${new Date().toISOString()} callbacks=${JSON.stringify([...callbacks])} contentTypes=${JSON.stringify([...contentTypes])}`,
          );
          expect(echoes, "callbacks carrying the bot's own reply").toEqual([]);
        } finally {
          await runner.stop();
          await new Promise((resolve) => server.close(() => resolve(undefined)));
        }
      },
      LISTEN_MS + 30_000,
    );
  },
  { failWhenIncomplete: true },
);
