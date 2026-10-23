/**
 * `NostrAdapter` — `BasePlatformAdapter` over `NostrRelayClient`, answering NIP-17 and NIP-04
 * direct messages sent to the bot's key.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  channelRendering,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";
import { makeAuthEvent } from "nostr-tools/nip42";
import { finalizeEvent, getPublicKey, type NostrEvent } from "nostr-tools/pure";

import {
  type DM_KIND,
  NIP04_KIND,
  type OpenedMessage,
  openGiftWrap,
  openNip04,
  sealDirectMessage,
  sealNip04,
} from "./dm.js";
import { parseNostrSecretKey } from "./keys.js";
import { type NostrPublishResult, NostrRelayClient } from "./relay-client.js";
import { messageOf } from "./relay-frames.js";
import { SeenIds } from "./seen-ids.js";
import type { NostrAdapterOptions, NostrRelayLike } from "./types.js";

const LABEL = "gateway-nostr";
const CONNECT_TIMEOUT_MS = 10_000;
const GIFT_WRAP = 1059;
/** NIP-59 backdates a wrap up to two days; ten minutes more cover the sender's clock. */
const WRAP_LOOKBACK_S = 172_800 + 600;
const PUBLIC_KEY = /^[0-9a-f]{64}$/;

/**
 * Nostr adapter for one bot key.
 *
 * `connect()` opens the relays and subscribes to gift wraps (kind 1059) and NIP-04 messages
 * (kind 4) addressed to the bot, answering `true` on the first `EOSE` and `false`, never a throw,
 * when none arrives within 10000 ms. A message older than `ignoreBefore`, one the bot's own key
 * wrote, or one already delivered (by wrap id or rumor id) produces no event. A reply goes back
 * by NIP-04 to a sender who last wrote with NIP-04, and as NIP-17 gift wraps to anyone else, with a
 * copy wrapped to the bot itself.
 *
 * @public
 */
export class NostrAdapter extends BasePlatformAdapter {
  readonly platform = "nostr" as const;
  private readonly secretKey: Uint8Array;
  private readonly pubkey: string;
  private readonly client: NostrRelayLike;
  private readonly ignoreBefore: number;
  private readonly seen = new SeenIds();
  private readonly schemeOf = new Map<string, typeof DM_KIND | typeof NIP04_KIND>();
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  private warnedAboutHtml = false;

  /**
   * @throws NostrKeyError when `secretKey` is not a valid key
   * @throws NostrRelayError when `relays` is empty or holds a URL that is not `ws:` or `wss:`
   */
  constructor(opts: NostrAdapterOptions) {
    super();
    const secretKey = parseNostrSecretKey(opts.secretKey);
    this.secretKey = secretKey;
    this.pubkey = getPublicKey(secretKey);
    this.client =
      opts.client ??
      new NostrRelayClient({
        relays: opts.relays,
        ...(opts.socketFactory === undefined ? {} : { socketFactory: opts.socketFactory }),
        signAuth: async (challenge, relay) =>
          finalizeEvent(makeAuthEvent(relay, challenge), secretKey),
      });
    this.ignoreBefore = opts.ignoreBefore ?? Math.floor(Date.now() / 1000);
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    // A second caller while the first is subscribing shares its answer instead of subscribing twice.
    if (this.connecting !== undefined) return this.connecting;
    const attempt = this.openSession().finally(() => {
      if (this.connecting === attempt) this.connecting = undefined;
    });
    this.connecting = attempt;
    return attempt;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connecting = undefined;
    this.client.close();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "NostrAdapter.connect() has not succeeded" },
      };
    }
    const recipient = out.channel.id;
    if (!PUBLIC_KEY.test(recipient)) {
      return {
        ok: false,
        error: {
          code: "invalid_channel",
          message: "channel.id must be the recipient's public key, 64 lowercase hex characters",
        },
      };
    }
    const text = this.textFor(out);
    if (this.schemeOf.get(recipient) === NIP04_KIND) {
      const event = sealNip04(this.secretKey, recipient, text);
      return toSendResult(await this.client.publish(event), event.id);
    }
    const sealed = sealDirectMessage(this.secretKey, this.pubkey, recipient, text);
    // Only the recipient's copy decides the answer; the bot's own copy is a convenience (EC-8).
    const [toRecipient] = await Promise.all([
      this.client.publish(sealed.toRecipient),
      this.client.publish(sealed.toSelf),
    ]);
    return toSendResult(toRecipient, sealed.rumorId);
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // Replace, not stack.
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = undefined;
      }
    };
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and Nostr direct messages are plain text; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  private async openSession(): Promise<boolean> {
    const ok = await withDeadline(this.subscribe(), CONNECT_TIMEOUT_MS);
    if (!ok) {
      process.stderr.write(
        `[${LABEL}] no relay answered the subscription within ${CONNECT_TIMEOUT_MS} ms\n`,
      );
      this.client.close();
      return false;
    }
    this.connected = true;
    return true;
  }

  private async subscribe(): Promise<boolean> {
    await this.client.open();
    return this.client.subscribe(
      [
        { kinds: [GIFT_WRAP], "#p": [this.pubkey], since: this.ignoreBefore - WRAP_LOOKBACK_S },
        { kinds: [NIP04_KIND], "#p": [this.pubkey], since: this.ignoreBefore },
      ],
      (event) => this.onRelayEvent(event),
    );
  }

  private onRelayEvent(event: NostrEvent): void {
    if (!this.seen.add(event.id)) return;
    const opened = this.open(event);
    if (opened === undefined) return;
    if (opened.pubkey === this.pubkey) return;
    // The message's own date, never the wrap's: NIP-59 backdates a wrap up to two days (FR-014).
    if (opened.createdAt < this.ignoreBefore) return;
    if (opened.id !== event.id && !this.seen.add(opened.id)) return;
    this.schemeOf.set(opened.pubkey, opened.kind);
    void this.runHandler(this.handler, toMessageEvent(opened)).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
    });
  }

  /** Decrypt a wrap or a kind 4 message; one that does not decrypt is logged by id and skipped. */
  private open(event: NostrEvent): OpenedMessage | undefined {
    try {
      if (event.kind === GIFT_WRAP) return openGiftWrap(event, this.secretKey);
      if (event.kind === NIP04_KIND) return openNip04(event, this.secretKey);
    } catch {
      // The library's message can quote decrypted bytes, so only the event id is logged.
      process.stderr.write(`[${LABEL}] could not open event ${event.id}; skipped\n`);
    }
    return undefined;
  }
}

function toMessageEvent(message: OpenedMessage): GatewayMessageEvent {
  return {
    id: message.id,
    platform: "nostr",
    sender: { id: message.pubkey },
    channel: { id: message.pubkey, type: "dm" },
    text: message.text,
    receivedAt: Date.now(),
    nostr: {
      pubkey: message.pubkey,
      kind: message.kind,
      createdAt: message.createdAt,
      raw: message.raw,
    },
  };
}

function toSendResult(result: NostrPublishResult, messageId: string): SendResult {
  if (result.ok) return { ok: true, messageId };
  return { ok: false, error: { code: result.code, message: result.message } };
}

/** `work`'s answer, or `false` once `ms` passes first. */
async function withDeadline(work: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
