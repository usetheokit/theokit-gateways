/**
 * Nextcloud Talk — live round trip against a real Nextcloud server, booted for the run.
 *
 * `nextcloud-talk:up` starts the server in Docker, installs Talk, makes a conversation and a bot
 * whose webhook is this adapter's listener on the host, and writes NEXTCLOUD_TALK_* into
 * `integration/.env`. The suite then writes in the conversation as `admin`, waits for that message
 * to reach the adapter through Talk's signed webhook, answers as the bot, and finds the answer in
 * the conversation's history. It prints the run date and both message ids as the record of the
 * run.
 *
 * Talk dials a local container, not the internet, so this suite does not need
 * INTEGRATION_PUBLIC_URL. It skips unless INTEGRATION_LIVE=1 and the variables are set.
 */

import type { MessageEvent } from "@theokit/gateway";
import { NextcloudTalkAdapter } from "@theokit/gateway-nextcloud-talk";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const TALK = platformById("nextcloud-talk");

interface ChatMessage {
  readonly id: number;
  readonly actorType: string;
  readonly message: string;
  readonly referenceId?: string;
}

/** A call to Talk's chat API as `admin`, the conversation's owner. */
async function chat(method: "GET" | "POST", query: string, body?: unknown): Promise<Response> {
  const auth = Buffer.from(`admin:${required("NEXTCLOUD_TALK_USER_PASSWORD")}`).toString("base64");
  return fetch(
    `${required("NEXTCLOUD_TALK_URL")}/ocs/v2.php/apps/spreed/api/v1/chat/${required("NEXTCLOUD_TALK_ROOM")}${query}`,
    {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        "ocs-apirequest": "true",
        accept: "application/json",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

async function history(): Promise<ChatMessage[]> {
  const response = await chat("GET", "?lookIntoFuture=0&limit=50");
  const answer = (await response.json()) as { ocs?: { data?: ChatMessage[] } };
  return answer.ocs?.data ?? [];
}

describeLive(TALK, "send and receive", () => {
  it("receives a user's message through the signed webhook and answers as the bot", async () => {
    const room = required("NEXTCLOUD_TALK_ROOM");
    const adapter = new NextcloudTalkAdapter({
      baseUrl: required("NEXTCLOUD_TALK_URL"),
      secret: required("NEXTCLOUD_TALK_BOT_SECRET"),
      port: Number(required("NEXTCLOUD_TALK_WEBHOOK_PORT")),
    });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });
    const marker = runMarker();
    try {
      expect(await adapter.connect(), "capabilities read and listener").toBe(true);

      const inbound = `${marker} from a user`;
      const posted = await chat("POST", "", { message: inbound });
      expect(posted.status, "admin's message").toBe(201);
      const received = await waitFor(() => events.find((event) => event.text === inbound), {
        timeoutMs: 60_000,
        label: "the user's message at the adapter",
      });
      expect(received.platform).toBe("nextcloud_talk");
      expect(received.channel).toEqual({ id: room, type: "group" });

      const outbound = `${marker} from the bot`;
      const sent = await adapter.sendMessage({
        channel: { id: room, type: "group" },
        text: outbound,
      });
      expect(sent.ok, JSON.stringify(sent.error)).toBe(true);
      const stored = await waitFor(
        async () =>
          (await history()).find(
            (message) => message.actorType === "bots" && message.message === outbound,
          ),
        { timeoutMs: 30_000, label: "the bot's answer in the conversation's history" },
      );

      expect(stored.referenceId).toBe(sent.messageId);
      process.stdout.write(
        `[nextcloud-talk live] ${new Date().toISOString()} conversation ${room}\n` +
          `[nextcloud-talk live] user message id ${received.id}: ${received.text}\n` +
          `[nextcloud-talk live] bot message id ${stored.id} (referenceId ${sent.messageId}): ${stored.message}\n`,
      );
    } finally {
      await adapter.disconnect();
    }
  }, 180_000);
});
