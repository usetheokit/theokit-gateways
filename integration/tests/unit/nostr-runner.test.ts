/**
 * `GatewayRunner` over `NostrAdapter`, offline (B-359 FR-007, AC-011).
 *
 * One gift wrap from a peer goes through the runner, the handler replies through `ctx.reply`, and
 * exactly one wrap addressed to the peer is published while `post_outbound` fires once with platform
 * `nostr`. A reply written straight to the adapter reaches the relay and leaves `post_outbound` at
 * zero. The relay is a scripted client handed to the adapter through its `client` seam, so no socket
 * is opened.
 */

import { type GatewayHook, GatewayRunner, type PlatformName } from "@theokit/gateway";
import { NostrAdapter, type NostrPublishResult, type NostrRelayLike } from "@theokit/gateway-nostr";
import type { Filter } from "nostr-tools/filter";
import { unwrapEvent, wrapEvent } from "nostr-tools/nip59";
import { generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";

const botKey = generateSecretKey();
const botPub = getPublicKey(botKey);
const peerKey = generateSecretKey();
const peerPub = getPublicKey(peerKey);

/** A relay that accepts every event and lets the test push one in. */
class ScriptedRelay implements NostrRelayLike {
  readonly published: NostrEvent[] = [];
  private onEvent: ((event: NostrEvent, relay: string) => void) | undefined;

  async open(): Promise<void> {}

  async subscribe(
    _filters: readonly Filter[],
    onEvent: (event: NostrEvent, relay: string) => void,
  ): Promise<boolean> {
    this.onEvent = onEvent;
    return true;
  }

  async publish(event: NostrEvent): Promise<NostrPublishResult> {
    this.published.push(event);
    return { ok: true };
  }

  close(): void {}

  push(event: NostrEvent): void {
    this.onEvent?.(event, "wss://scripted");
  }

  /** The texts of the published wraps addressed to the peer. */
  sentToPeer(): string[] {
    return this.published
      .filter((event) => event.tags.some((tag) => tag[0] === "p" && tag[1] === peerPub))
      .map((event) => unwrapEvent(event, peerKey).content);
  }
}

function giftFromPeer(text: string): NostrEvent {
  return wrapEvent(
    { kind: 14, content: text, tags: [["p", botPub]], created_at: Math.floor(Date.now() / 1000) },
    peerKey,
    botPub,
  );
}

function countingHook(): { hook: GatewayHook; platforms: PlatformName[] } {
  const platforms: PlatformName[] = [];
  return {
    platforms,
    hook: {
      name: "count-post-outbound",
      post_outbound(ctx) {
        platforms.push(ctx.event.platform);
      },
    },
  };
}

function makeAdapter(relay: ScriptedRelay): NostrAdapter {
  return new NostrAdapter({
    secretKey: Buffer.from(botKey).toString("hex"),
    relays: ["wss://scripted"],
    ignoreBefore: Math.floor(Date.now() / 1000) - 60,
    client: relay,
  });
}

const running: GatewayRunner[] = [];

afterEach(async () => {
  for (const runner of running.splice(0)) await runner.stop();
});

describe("GatewayRunner drives NostrAdapter", () => {
  it("gives one inbound one publish to the peer and one post_outbound for nostr", async () => {
    const relay = new ScriptedRelay();
    const { hook, platforms } = countingHook();
    let markHandled: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    const runner = new GatewayRunner({
      adapters: [makeAdapter(relay)],
      hooks: [hook],
      handler: async (_event, ctx) => {
        await ctx.reply("hello back");
        markHandled();
      },
    });
    running.push(runner);
    await runner.start();

    relay.push(giftFromPeer("hello"));
    await handled;

    expect(relay.sentToPeer()).toEqual(["hello back"]);
    expect(platforms).toEqual(["nostr"]);
  });

  it("leaves post_outbound at zero for a reply written around the runner", async () => {
    const relay = new ScriptedRelay();
    const adapter = makeAdapter(relay);
    const { hook, platforms } = countingHook();
    const runner = new GatewayRunner({
      adapters: [adapter],
      hooks: [hook],
      handler: async () => undefined,
    });
    running.push(runner);
    await runner.start();

    const result = await adapter.sendMessage({
      channel: { id: peerPub, type: "dm" },
      text: "written around the runner",
    });

    expect(result.ok).toBe(true);
    expect(relay.sentToPeer()).toEqual(["written around the runner"]);
    expect(platforms).toEqual([]);
  });
});
