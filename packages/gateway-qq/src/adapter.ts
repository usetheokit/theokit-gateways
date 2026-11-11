/**
 * `QQAdapter` — `BasePlatformAdapter` over a QQ Bot: gateway WebSocket in, OpenAPI v2 out.
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

import { QQApi } from "./api.js";
import { refuseAttachments } from "./refuse-attachments.js";
import { QQSession } from "./session.js";
import { splitForQQ } from "./split.js";
import type { QQAdapterOptions } from "./types.js";

const LABEL = "gateway-qq";
const SCENES: Readonly<Record<string, "c2c" | "group" | undefined>> = {
  C2C_MESSAGE_CREATE: "c2c",
  GROUP_AT_MESSAGE_CREATE: "group",
};

interface Inbound {
  readonly id?: unknown;
  readonly content?: unknown;
  readonly timestamp?: unknown;
  readonly group_openid?: unknown;
  readonly author?: { readonly user_openid?: unknown; readonly member_openid?: unknown };
}

/** The last inbound message of a channel: a passive reply cites its id, with a rising `msg_seq`. */
interface ReplyState {
  msgId: string;
  seq: number;
}

/**
 * QQ Bot adapter.
 *
 * `connect()` exchanges the AppID and AppSecret for an access token, opens the gateway socket and
 * answers `true` once the gateway says READY, `false` (never a throw) otherwise. A C2C message
 * becomes a `dm` event (`channel.id` = the user's openid); a group @-mention becomes a `group`
 * event (`channel.id` = the group openid). A reply is a passive reply to the channel's latest
 * inbound message (or to `replyTo`), which QQ accepts for a limited time; a refusal comes back as
 * `qq_send_failed` with QQ's code. Text over 1500 characters goes as several messages.
 *
 * @public
 */
export class QQAdapter extends BasePlatformAdapter {
  readonly platform = "qq" as const;
  private readonly api: QQApi;
  private readonly session: QQSession;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private readonly seen = new Set<string>();
  private readonly replies = new Map<string, ReplyState>();

  /** @throws Error when `appId` or `clientSecret` is empty */
  constructor(opts: QQAdapterOptions) {
    super();
    for (const key of ["appId", "clientSecret"] as const) {
      if (typeof opts[key] !== "string" || opts[key] === "") {
        throw new Error(`${LABEL}: opts.${key} is required`);
      }
    }
    this.api = new QQApi(opts);
    this.session = new QQSession(this.api, opts, (type, data) => this.onDispatchEvent(type, data));
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    this.connected = await this.session.start();
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.session.stop();
    this.api.forget();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "QQAdapter.connect() has not succeeded" },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a QQ openid" },
      };
    }
    const text =
      out.format === "markdown" ? channelRendering(this.platform).translate(out.text) : out.text;
    return this.sendParts(out, splitForQQ(text));
  }

  private async sendParts(out: OutboundMessage, parts: string[]): Promise<SendResult> {
    const scene = out.channel.type === "dm" ? "c2c" : "group";
    const msgId = out.replyTo ?? this.replies.get(out.channel.id)?.msgId;
    let last = "";
    try {
      for (const content of parts) {
        last = await this.api.sendText(scene, out.channel.id, content, {
          ...(msgId === undefined ? {} : { msgId }),
          msgSeq: this.nextSeq(out.channel.id, msgId),
        });
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "qq_send_failed",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
    return { ok: true, messageId: last };
  }

  /** `msg_seq` must rise for each reply to one message id. */
  private nextSeq(channelId: string, msgId: string | undefined): number {
    const state = this.replies.get(channelId);
    return state !== undefined && state.msgId === msgId ? ++state.seq : 1;
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  private onDispatchEvent(type: string, data: unknown): void {
    const scene = SCENES[type];
    if (scene === undefined) return;
    const event = toMessageEvent(scene, (data ?? {}) as Inbound);
    if (event === undefined || this.seen.has(event.id)) return;
    this.remember(event);
    this.runHandler(this.handler, event).then((outcome) => {
      if (outcome === "handler_threw") process.stderr.write(`[${LABEL}] handler threw\n`);
    });
  }

  private remember(event: GatewayMessageEvent): void {
    this.seen.add(event.id);
    if (this.seen.size > 1000) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.replies.delete(event.channel.id);
    this.replies.set(event.channel.id, { msgId: event.id, seq: 0 });
    if (this.replies.size > 1000) {
      const oldest = this.replies.keys().next().value;
      if (oldest !== undefined) this.replies.delete(oldest);
    }
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toMessageEvent(scene: "c2c" | "group", d: Inbound): GatewayMessageEvent | undefined {
  const id = str(d.id);
  const sender = str(scene === "c2c" ? d.author?.user_openid : d.author?.member_openid);
  const channelId = scene === "c2c" ? sender : str(d.group_openid);
  if (id === "" || sender === "" || channelId === "" || typeof d.content !== "string") {
    return undefined;
  }
  const ts = Date.parse(str(d.timestamp));
  return {
    id,
    platform: "qq",
    sender: { id: sender },
    channel: { id: channelId, type: scene === "c2c" ? "dm" : "group" },
    text: d.content.trim(),
    receivedAt: Number.isFinite(ts) ? ts : Date.now(),
    qq: { messageId: id, senderId: sender, scene, raw: d },
  } as GatewayMessageEvent;
}
