/**
 * Live send-and-receive against a real relay. Skipped unless all three variables are set:
 *
 *   NOSTR_LIVE_RELAY     a `wss:` relay URL both keys may use
 *   NOSTR_LIVE_BOT_KEY   the bot's nsec or hex secret key
 *   NOSTR_LIVE_PEER_KEY  a second, throwaway nsec or hex secret key (the "user")
 *
 * Run: `pnpm test:live`. Record the date and result in README.md under "Live run".
 */
import { getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { NostrAdapter } from "../../src/adapter.js";
import { parseNostrSecretKey } from "../../src/keys.js";

const relay = process.env.NOSTR_LIVE_RELAY;
const botKey = process.env.NOSTR_LIVE_BOT_KEY;
const peerKey = process.env.NOSTR_LIVE_PEER_KEY;
const configured = Boolean(relay && botKey && peerKey);

function nextText(adapter: NostrAdapter): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message within 30 s")), 30_000);
    const off = adapter.onInbound(async (event) => {
      clearTimeout(timer);
      off();
      resolve(event.text);
    });
  });
}

describe.skipIf(!configured)("Nostr live account", () => {
  it("the bot receives a peer's direct message and the peer receives the bot's reply", async () => {
    const bot = new NostrAdapter({ secretKey: botKey as string, relays: [relay as string] });
    const peer = new NostrAdapter({ secretKey: peerKey as string, relays: [relay as string] });
    const botPub = getPublicKey(parseNostrSecretKey(botKey as string));
    const peerPub = getPublicKey(parseNostrSecretKey(peerKey as string));
    const stamp = Date.now();
    try {
      expect(await bot.connect()).toBe(true);
      expect(await peer.connect()).toBe(true);
      const atBot = nextText(bot);
      const atPeer = nextText(peer);
      const sent = await peer.sendMessage({
        channel: { id: botPub, type: "dm" },
        text: `live ping ${stamp}`,
      });
      expect(sent.ok).toBe(true);
      expect(await atBot).toBe(`live ping ${stamp}`);
      const replied = await bot.sendMessage({
        channel: { id: peerPub, type: "dm" },
        text: `live pong ${stamp}`,
      });
      expect(replied.ok).toBe(true);
      expect(await atPeer).toBe(`live pong ${stamp}`);
    } finally {
      await bot.disconnect();
      await peer.disconnect();
    }
  }, 90_000);
});
