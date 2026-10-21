/**
 * Signal — live round trip against real Signal accounts, through signal-cli.
 *
 * Two accounts, both registered in signal-cli's data directory: `SIGNAL_ACCOUNT` is the bot and
 * `SIGNAL_PEER` is the throwaway account it talks to. The suite drives each with its own
 * `SignalAdapter` (one signal-cli process each), sends one message bot → peer and one peer → bot,
 * and prints the run date and both Signal timestamps as the record of the run.
 *
 * It skips, naming why, when the run is not opted into, a variable is missing, or signal-cli is
 * not on PATH — on this repository's CI host none of the three is provided.
 */

import { spawnSync } from "node:child_process";

import type { MessageEvent } from "@theokit/gateway";
import { SignalAdapter } from "@theokit/gateway-signal";
import { describe, expect, it } from "vitest";

import {
  liveRunEnabled,
  missingFor,
  optional,
  required,
  runMarker,
} from "../../src/credentials.js";
import { describeLive, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const SIGNAL = platformById("signal");
const SIGNAL_CLI = optional("SIGNAL_CLI_PATH") ?? "signal-cli";

/** Whether the signal-cli binary answers `--version`; a missing binary makes the suite skip. */
function signalCliOnPath(): boolean {
  const probe = spawnSync(SIGNAL_CLI, ["--version"], { stdio: "ignore", timeout: 30_000 });
  return probe.error === undefined && probe.status === 0;
}

function adapterFor(account: string): SignalAdapter {
  return new SignalAdapter({
    account,
    signalCliPath: SIGNAL_CLI,
    ...(optional("SIGNAL_CONFIG_DIR") === undefined
      ? {}
      : { configDir: required("SIGNAL_CONFIG_DIR") }),
    connectTimeoutMs: 60_000,
  });
}

/** Collect inbound events on `adapter` so a test can wait for one carrying its marker. */
function inbox(adapter: SignalAdapter): MessageEvent[] {
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  return events;
}

const body = (): void => {
  it("sends a message to the peer and receives the peer's answer", async () => {
    const bot = adapterFor(required("SIGNAL_ACCOUNT"));
    const peer = adapterFor(required("SIGNAL_PEER"));
    const marker = runMarker();
    try {
      expect(await bot.connect(), "bot signal-cli connect").toBe(true);
      expect(await peer.connect(), "peer signal-cli connect").toBe(true);
      const botInbox = inbox(bot);
      const peerInbox = inbox(peer);

      const out = await bot.sendMessage({
        channel: { id: required("SIGNAL_PEER"), type: "dm" },
        text: `${marker} ping`,
      });
      expect(out.ok, JSON.stringify(out.error)).toBe(true);
      const atPeer = await waitFor(() => peerInbox.find((e) => e.text === `${marker} ping`), {
        timeoutMs: 120_000,
        intervalMs: 1_000,
        label: "the bot's message at the peer",
      });

      const back = await peer.sendMessage({ channel: atPeer.channel, text: `${marker} pong` });
      expect(back.ok, JSON.stringify(back.error)).toBe(true);
      const atBot = await waitFor(() => botInbox.find((e) => e.text === `${marker} pong`), {
        timeoutMs: 120_000,
        intervalMs: 1_000,
        label: "the peer's answer at the bot",
      });

      expect(atBot.platform).toBe("signal");
      process.stdout.write(
        `[signal live] ${new Date().toISOString()} sent ${out.messageId} received ${
          atBot.platform === "signal" ? atBot.signal.timestamp : "?"
        }\n`,
      );
    } finally {
      await bot.disconnect();
      await peer.disconnect();
    }
  }, 300_000);
};

// The binary is probed only when the run would otherwise go ahead: vitest collects a skipped
// suite's body too, and a probe there would cost up to 30 s on every offline run.
if (liveRunEnabled() && missingFor(SIGNAL).length === 0 && !signalCliOnPath()) {
  const where =
    optional("SIGNAL_CLI_PATH") === undefined ? "not on PATH" : "at SIGNAL_CLI_PATH does not run";
  describe.skip(`${SIGNAL.label} — send and receive [skipped: signal-cli ${where}]`, body);
} else {
  describeLive(SIGNAL, "send and receive", body);
}
