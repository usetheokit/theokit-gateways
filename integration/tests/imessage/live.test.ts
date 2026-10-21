/**
 * iMessage — live round trip on a Mac signed in to Messages, through `imsg rpc`.
 *
 * `IMESSAGE_CLI_PATH` is the `imsg` binary (or an ssh wrapper that runs `imsg rpc` on the Mac) and
 * `IMESSAGE_PEER_CHAT_ID` is `imsg`'s numeric id of a chat with a second person or device. The
 * suite sends one message to that chat, waits for one inbound message from it, and prints the run
 * date, the `imsg` version and both guids as the record of the run. The answer has to come from
 * someone on the peer device: the adapter drops messages the signed-in account sent, so the
 * suite's own send never counts as the inbound half.
 *
 * It skips, naming the first missing condition: not macOS, the run not opted into
 * (`INTEGRATION_LIVE=1`), `IMESSAGE_CLI_PATH` unset, or `IMESSAGE_PEER_CHAT_ID` unset. On this
 * repository's Linux CI host the first one always applies.
 */

import { spawnSync } from "node:child_process";

import type { MessageEvent } from "@theokit/gateway";
import { IMessageAdapter } from "@theokit/gateway-imessage";
import { describe, expect, it } from "vitest";

import { liveRunEnabled, optional, required, runMarker } from "../../src/credentials.js";
import { describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const IMESSAGE = platformById("imessage");
const SUITE = "send and receive";

/** `imsg --version`, for the record of the run; `unknown` when it does not answer. */
function imsgVersion(cliPath: string): string {
  const probe = spawnSync(cliPath, ["--version"], { encoding: "utf8", timeout: 30_000 });
  return probe.status === 0 ? probe.stdout.trim() : "unknown";
}

/** The first condition this host does not meet, or `undefined` when the suite can run. */
function firstMissingCondition(): string | undefined {
  if (process.platform !== "darwin") return "not macOS";
  if (!liveRunEnabled()) return "set INTEGRATION_LIVE=1 to talk to real APIs";
  if (optional("IMESSAGE_CLI_PATH") === undefined) return "IMESSAGE_CLI_PATH unset";
  if (optional("IMESSAGE_PEER_CHAT_ID") === undefined) return "IMESSAGE_PEER_CHAT_ID unset";
  return undefined;
}

const body = (): void => {
  it("sends a message to the peer chat and receives one from it", async () => {
    const cliPath = required("IMESSAGE_CLI_PATH");
    const chatId = required("IMESSAGE_PEER_CHAT_ID");
    const adapter = new IMessageAdapter({ cliPath, connectTimeoutMs: 60_000 });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });
    const marker = runMarker();
    try {
      expect(await adapter.connect(), "imsg rpc connect").toBe(true);

      const out = await adapter.sendMessage({
        channel: { id: chatId, type: "dm" },
        text: `${marker} ping, answer with anything`,
      });
      expect(out.ok, JSON.stringify(out.error)).toBe(true);
      const answer = await waitFor(() => events.find((e) => e.channel.id === chatId), {
        timeoutMs: 300_000,
        intervalMs: 1_000,
        label: "a message from the peer chat",
      });

      expect(answer.platform).toBe("imessage");
      process.stdout.write(
        `[imessage live] ${new Date().toISOString()} imsg ${imsgVersion(cliPath)} sent ${
          out.messageId
        } received ${answer.id}\n`,
      );
    } finally {
      await adapter.disconnect();
    }
  }, 600_000);
};

const missing = firstMissingCondition();
if (missing === undefined) {
  describeLiveInbound(IMESSAGE, SUITE, body);
} else {
  describe.skip(`${IMESSAGE.label} — ${SUITE} [skipped: ${missing}]`, body);
}
