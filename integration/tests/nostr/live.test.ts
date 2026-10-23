/**
 * Nostr — live round trip through a real relay (B-359 AC-012).
 *
 * A peer key sends the bot a NIP-17 gift wrap through `NOSTR_RELAY_URL`; the bot's adapter, run by
 * `GatewayRunner`, answers it; the peer reads the answer back from the same relay. The suite prints
 * the run date, the relay and both texts as the record of the run.
 *
 * It skips unless `INTEGRATION_LIVE=1` and `NOSTR_SECRET_KEY`, `NOSTR_RELAY_URL` and
 * `NOSTR_PEER_SECRET_KEY` are set, and it fails, naming what is missing, when only some are.
 */

import { GatewayRunner } from "@theokit/gateway";
import { NostrAdapter, NostrRelayClient, parseNostrSecretKey } from "@theokit/gateway-nostr";
import { makeAuthEvent } from "nostr-tools/nip42";
import { unwrapEvent, wrapEvent } from "nostr-tools/nip59";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const NOSTR = platformById("nostr");
/** NIP-59 backdates a wrap up to two days; ten minutes more cover clock skew. */
const WRAP_LOOKBACK_S = 172_800 + 600;

describeLive(
  NOSTR,
  "receive a DM and answer it",
  () => {
    it("answers a gift wrap from a peer, and the peer reads the answer", async () => {
      const relay = required("NOSTR_RELAY_URL");
      const botKey = parseNostrSecretKey(required("NOSTR_SECRET_KEY"));
      const peerKey = parseNostrSecretKey(required("NOSTR_PEER_SECRET_KEY"));
      const botPub = getPublicKey(botKey);
      const peerPub = getPublicKey(peerKey);
      const marker = runMarker();

      const adapter = new NostrAdapter({
        secretKey: required("NOSTR_SECRET_KEY"),
        relays: [relay],
      });
      const runner = new GatewayRunner({
        adapters: [adapter],
        handler: async (event, ctx) => {
          await ctx.reply(`answer to ${event.text}`);
        },
      });
      const peer = new NostrRelayClient({
        relays: [relay],
        signAuth: async (challenge, url) => finalizeEvent(makeAuthEvent(url, challenge), peerKey),
      });
      const answers: string[] = [];
      try {
        await runner.start();
        await peer.open();
        await peer.subscribe(
          [
            {
              kinds: [1059],
              "#p": [peerPub],
              since: Math.floor(Date.now() / 1000) - WRAP_LOOKBACK_S,
            },
          ],
          (wrap) => {
            try {
              const rumor = unwrapEvent(wrap, peerKey);
              if (rumor.pubkey === botPub) answers.push(rumor.content);
            } catch {
              // A wrap to this key that does not open is not the bot's answer; it is left alone.
            }
          },
        );
        const sent = await peer.publish(
          wrapEvent({ kind: 14, content: marker, tags: [["p", botPub]] }, peerKey, botPub),
        );
        expect(sent).toEqual({ ok: true });

        const answer = await waitFor(() => answers.find((text) => text === `answer to ${marker}`), {
          timeoutMs: 60_000,
          intervalMs: 500,
          label: "the bot's answer on the relay",
        });
        console.log(
          `[nostr live] ${new Date().toISOString()} relay=${relay} sent=${marker} answered=${answer}`,
        );
      } finally {
        peer.close();
        await runner.stop();
      }
    }, 90_000);
  },
  { failWhenIncomplete: true },
);
