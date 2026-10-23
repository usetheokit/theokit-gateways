/**
 * IRC — live round trip on a public network, by default Libera.Chat over TLS.
 *
 * The adapter registers `IRC_NICK` (unregistered, no SASL) and joins a channel made for this run,
 * `#theokit-it-<8 random hex>`, so nobody else is in it. A second raw `node:tls` client joins the
 * same channel as the peer. The suite sends one message each way, checks each side received the
 * other's, and prints the run date, the server name from numeric 002 and both messages as the
 * record of the run. Both nicks part at the end, and the channel ceases to exist once it is empty.
 *
 * It skips unless `INTEGRATION_LIVE=1`, `IRC_NICK` and `IRC_HOST` are set.
 */

import { randomBytes } from "node:crypto";
import { connect, type TLSSocket } from "node:tls";

import type { MessageEvent } from "@theokit/gateway";
import { IrcAdapter } from "@theokit/gateway-irc";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const IRC = platformById("irc");
const PORT = 6697;

/** A bare IRC client: registers a nick, records every line, and writes what it is told. */
class PeerClient {
  readonly lines: string[] = [];
  private readonly socket: TLSSocket;

  constructor(host: string, nick: string) {
    this.socket = connect({ host, port: PORT, servername: host });
    let buffered = "";
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => {
      buffered += chunk;
      for (let at = buffered.indexOf("\n"); at !== -1; at = buffered.indexOf("\n")) {
        const line = buffered.slice(0, at).replace(/\r$/, "");
        buffered = buffered.slice(at + 1);
        this.lines.push(line);
        if (line.startsWith("PING ")) this.write(`PONG ${line.slice(5)}`);
      }
    });
    this.write(`NICK ${nick}`);
    this.write(`USER ${nick} 0 * :theokit integration peer`);
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  /** The first line whose command (after the prefix) is `command`, once it arrives. */
  async first(command: string, label: string): Promise<string> {
    return waitFor(() => this.lines.find((line) => line.split(" ")[1] === command), {
      timeoutMs: 60_000,
      intervalMs: 250,
      label,
    });
  }

  end(): void {
    this.write("QUIT :done");
    this.socket.end();
  }
}

describeLive(IRC, "send and receive", () => {
  it("sends a message to a fresh channel and receives one from a second client", async () => {
    const host = required("IRC_HOST");
    const nick = required("IRC_NICK");
    const channel = `#theokit-it-${randomBytes(4).toString("hex")}`;
    const marker = runMarker();
    const adapter = new IrcAdapter({
      host,
      port: PORT,
      nick,
      channels: [channel],
      connectTimeoutMs: 60_000,
    });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });
    const peer = new PeerClient(host, `${nick.slice(0, 10)}pr`);
    try {
      const welcome = await peer.first("001", "the peer's 001");
      const yourHost = await peer.first("002", "the peer's 002");
      expect(welcome).toContain(" 001 ");
      peer.write(`JOIN ${channel}`);
      await peer.first("366", "the peer's JOIN");

      expect(await adapter.connect(), "registration and JOIN").toBe(true);

      const outbound = `${marker} from the adapter`;
      const sent = await adapter.sendMessage({
        channel: { id: channel, type: "group" },
        text: outbound,
      });
      expect(sent.ok, JSON.stringify(sent.error)).toBe(true);
      await waitFor(() => peer.lines.find((line) => line.endsWith(`:${outbound}`)), {
        timeoutMs: 60_000,
        label: "the adapter's message at the peer",
      });

      const inbound = `${marker} from the peer`;
      peer.write(`PRIVMSG ${channel} :${inbound}`);
      const received = await waitFor(() => events.find((event) => event.text === inbound), {
        timeoutMs: 60_000,
        label: "the peer's message at the adapter",
      });

      expect(received.platform).toBe("irc");
      expect(received.channel).toEqual({ id: channel, type: "group" });
      const serverName = yourHost.split(" ")[0]?.replace(/^:/, "") ?? "unknown";
      process.stdout.write(
        `[irc live] ${new Date().toISOString()} server ${serverName} channel ${channel}\n` +
          `[irc live] sent: ${outbound}\n[irc live] received: ${received.text}\n`,
      );
    } finally {
      peer.write(`PART ${channel}`);
      peer.end();
      await adapter.disconnect();
    }
  }, 300_000);
});
