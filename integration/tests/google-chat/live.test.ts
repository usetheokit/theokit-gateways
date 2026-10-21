/**
 * Google Chat — live round trip through a Chat app with an HTTP endpoint.
 *
 * NEVER EXECUTED. No Google Cloud project, Chat app or service account exists for this host, so
 * the suite skips naming what it wants. It is written so that the first operator who provisions
 * one can run it unchanged.
 *
 * The adapter listens on `INTEGRATION_PUBLIC_PORT` (default 3100), the port the tunnel behind
 * `INTEGRATION_PUBLIC_URL` forwards to, at the default `/google-chat` route. The Chat app's HTTP
 * endpoint URL must be that public URL plus the route, and must equal `GOOGLE_CHAT_AUDIENCE`
 * exactly: Chat signs every request for that audience, and the adapter refuses any other. The
 * suite sends one message to `GOOGLE_CHAT_SPACE`, waits for one message from that space to reach
 * the handler (someone in the space answers the test message), and prints the run date and both
 * message names as the record of the run.
 */

import type { MessageEvent } from "@theokit/gateway";
import { GoogleChatAdapter } from "@theokit/gateway-google-chat";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const GOOGLE_CHAT = platformById("google-chat");

/** The port the tunnel forwards to. Fixed, because the tunnel was started against it. */
const PORT = Number(process.env.INTEGRATION_PUBLIC_PORT ?? 3100);

describeLiveInbound(GOOGLE_CHAT, "send and receive", () => {
  it("sends a message to the space and receives one from it", async () => {
    const space = required("GOOGLE_CHAT_SPACE");
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: required("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL"),
      privateKey: required("GOOGLE_CHAT_PRIVATE_KEY"),
      audience: required("GOOGLE_CHAT_AUDIENCE"),
      port: PORT,
      connectTimeoutMs: 30_000,
    });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });
    const marker = runMarker();
    try {
      expect(await adapter.connect(), "token exchange and listener").toBe(true);

      const out = await adapter.sendMessage({
        channel: { id: space, type: "group" },
        text: `${marker} ping, answer with anything`,
      });
      expect(out.ok, JSON.stringify(out.error)).toBe(true);
      const answer = await waitFor(() => events.find((e) => e.channel.id === space), {
        timeoutMs: 300_000,
        intervalMs: 1_000,
        label: "a message from the space",
      });

      expect(answer.platform).toBe("google_chat");
      process.stdout.write(
        `[google-chat live] ${new Date().toISOString()} sent ${out.messageId} received ${answer.id}\n`,
      );
    } finally {
      await adapter.disconnect();
    }
  }, 600_000);
});
