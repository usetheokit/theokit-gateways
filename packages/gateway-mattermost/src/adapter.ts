/**
 * `MattermostAdapter` — implements BasePlatformAdapter over Client4 + WS.
 * ADRs D397-D404.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import {
  type ConnectOptions,
  connectMattermost,
  getChannelCached,
  type MattermostClientHandle,
  type WSMessage,
} from "./client.js";
import { ConfigurationError } from "./errors.js";
import { shouldRespond } from "./filters.js";
import { mapChannelType, normalizeMattermostType, postToMessageEvent } from "./normalize.js";
import { MATTERMOST_MAX_POST, splitForMattermost } from "./split.js";
import type { MattermostAdapterOptions, MattermostPost } from "./types.js";

export class MattermostAdapter extends BasePlatformAdapter {
  readonly platform = "mattermost" as const;
  private readonly opts: MattermostAdapterOptions;
  private handle: MattermostClientHandle | undefined;
  private inboundHandler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private wsListener: ((msg: WSMessage) => void) | undefined;
  private connected = false;

  constructor(opts: MattermostAdapterOptions) {
    super();
    if (opts.baseUrl.length === 0) {
      throw new ConfigurationError({
        code: "base_url_required",
        message: 'gateway-mattermost: opts.baseUrl is empty (e.g. "https://mattermost.acme.com")',
      });
    }
    if (opts.accessToken.length === 0) {
      throw new ConfigurationError({
        code: "access_token_required",
        message:
          "gateway-mattermost: opts.accessToken is empty (generate one in System Console → Integrations → Bot Accounts)",
      });
    }
    this.opts = opts;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      this.handle = await connectMattermost({
        baseUrl: this.opts.baseUrl,
        accessToken: this.opts.accessToken,
      } satisfies ConnectOptions);
      this.attachWsListener();
      this.connected = true;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-mattermost] connect failed: ${msg}\n`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    if (this.handle !== undefined && this.wsListener !== undefined) {
      this.handle.ws.removeMessageListener(this.wsListener);
    }
    this.handle?.ws.close();
    this.handle = undefined;
    this.wsListener = undefined;
    this.connected = false;
    this.inboundHandler = undefined;
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (this.handle === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "MattermostAdapter.connect() not called" },
      };
    }
    try {
      // Split before sending. This package used to post `out.text` whole, alone
      // among the ten adapters, so anything past Mattermost's 16383-rune cap came
      // back HTTP 400 and the user saw nothing at all.
      let lastId: string | undefined;
      // Mattermost parses markdown natively, so `markdown` needs no flag; `plain` is the
      // case that needs work, because raw text would be parsed anyway.
      // Split first, escape per chunk — the same ordering Discord needs, for the same reason:
      // a cut between a backslash and its character produces a stray backslash in one message
      // and a bare marker in the next.
      for (const raw of splitForMattermost(out.text)) {
        const chunk = out.format === "plain" ? escapeMarkdown(raw) : raw;
        const post = await this.handle.client.createPost({
          channel_id: out.channel.id,
          message: chunk,
          ...(out.channel.type === "thread" && out.channel.topicId !== undefined
            ? { root_id: out.channel.topicId }
            : {}),
        });
        lastId = post.id;
      }
      return { ok: true, ...(lastId !== undefined ? { messageId: lastId } : {}) };
    } catch (err) {
      return mapMattermostError(err);
    }
  }

  /** Mattermost edits a sent post's text through `Client4.patchPost`. */
  override readonly supportsEdit = true;

  /**
   * Replace the text of a post this bot sent, through `patchPost({ id, message })`.
   *
   * Applies `sendMessage`'s checks (`empty_text`, then `not_connected`), refuses an empty id, and
   * refuses a text `splitForMattermost` would cut in two as `edit_too_long`, all with no request.
   * A `plain` text is escaped as `sendMessage` escapes it, and an escaped body longer than one
   * post is refused as `edit_too_long` too, with no request.
   */
  override async editMessage(messageId: string, out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (this.handle === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "MattermostAdapter.connect() not called" },
      };
    }
    if (messageId.length === 0) {
      return { ok: false, error: { code: "invalid_message_id", message: "message id is empty" } };
    }
    const parts = splitForMattermost(out.text);
    if (parts.length !== 1) return editPartsRefusal(parts.length);
    const raw = parts[0] as string;
    // The splitter measured the caller's text; escaping a `plain` text can lengthen it past the
    // cap, which the server answers with a 400 only after the request.
    const message = out.format === "plain" ? escapeMarkdown(raw) : raw;
    if (message.length > MATTERMOST_MAX_POST) return escapedTooLongRefusal(message.length);
    try {
      await this.handle.client.patchPost({ id: messageId, message });
    } catch (err) {
      return mapMattermostError(err);
    }
    return { ok: true, messageId };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace, not stack.
    this.inboundHandler = handler;
    return () => {
      if (this.inboundHandler === handler) this.inboundHandler = undefined;
    };
  }

  /** Escape hatch: caller can drive REST directly when v0.1 doesn't expose a feature. */
  getClient(): MattermostClientHandle | undefined {
    return this.handle;
  }

  private attachWsListener(): void {
    if (this.handle === undefined) return;
    const handle = this.handle;
    this.wsListener = (msg: WSMessage) => {
      if (msg.event !== "posted") return;
      void this.processPostedEvent(handle, msg).catch((err: unknown) => {
        const m = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[gateway-mattermost] processPostedEvent failed: ${m}\n`);
      });
    };
    handle.ws.addMessageListener(this.wsListener);
  }

  private async processPostedEvent(handle: MattermostClientHandle, msg: WSMessage): Promise<void> {
    const post = parsePostFromWS(msg);
    if (post === undefined) return;
    const channel = await getChannelCached(handle, post.channel_id);
    const rawType = normalizeMattermostType(channel);
    const channelType = mapChannelType(rawType, post.root_id.length > 0);
    const requireMention = this.opts.requireMention ?? true;
    if (
      !shouldRespond({
        post,
        channelType,
        botUserId: handle.botUserId,
        botUsername: handle.botUsername,
        requireMention,
      })
    ) {
      return;
    }
    const senderUsername =
      typeof msg.data.sender_name === "string"
        ? (msg.data.sender_name as string).replace(/^@/, "")
        : undefined;
    const event = postToMessageEvent(post, channel, senderUsername);
    if (this.inboundHandler === undefined) return;
    try {
      await this.inboundHandler(event);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-mattermost] handler threw: ${m}\n`);
    }
  }

  /**
   * Deliver an event that arrived out of band — the ingest `onInbound` had no counterpart for (#83).
   *
   * One line over `runHandler`, which owns the containment: a handler is user code, its throw is
   * named as the handler's failure rather than the platform's, and delivery continues.
   */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.inboundHandler, event);
  }
}

/**
 * Parse the `data.post` JSON envelope from a Mattermost WS `posted` event.
 *
 * @public — exposed so consumers can drive their own WS listener too.
 */
export function parsePostFromWS(msg: WSMessage): MattermostPost | undefined {
  const raw = msg.data?.post;
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<MattermostPost>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.user_id !== "string" ||
      typeof parsed.channel_id !== "string" ||
      typeof parsed.message !== "string"
    ) {
      return undefined;
    }
    return {
      id: parsed.id,
      user_id: parsed.user_id,
      channel_id: parsed.channel_id,
      root_id: typeof parsed.root_id === "string" ? parsed.root_id : "",
      message: parsed.message,
      create_at: typeof parsed.create_at === "number" ? parsed.create_at : 0,
      metadata: parsed.metadata,
    };
  } catch {
    return undefined;
  }
}

interface MattermostRestError {
  status_code?: number;
  message?: string;
}

/**
 * The refusal for a text that is not exactly one Mattermost post.
 *
 * More than one part is `edit_too_long`. No parts cannot happen today, since
 * `splitForMattermost` returns at least one part for any non-empty text and empty text is refused
 * earlier; the arm keeps a later splitter that returns `[]` from editing with `undefined`.
 */
function editPartsRefusal(partCount: number): SendResult {
  if (partCount > 1) {
    return {
      ok: false,
      error: {
        code: "edit_too_long",
        message: `text needs ${partCount} Mattermost posts; an edit replaces one`,
      },
    };
  }
  return { ok: false, error: { code: "empty_text", message: "text reduced to zero parts" } };
}

/** The refusal for one part whose escaped body is longer than one Mattermost post. */
function escapedTooLongRefusal(length: number): SendResult {
  return {
    ok: false,
    error: {
      code: "edit_too_long",
      message: `escaped text is ${length} characters; a Mattermost post holds ${MATTERMOST_MAX_POST}`,
    },
  };
}

function mapMattermostError(err: unknown): SendResult {
  const e = err as MattermostRestError;
  const status = e.status_code ?? 0;
  if (status === 429) {
    return {
      ok: false,
      error: { code: "rate_limit", message: e.message ?? "Mattermost rate limit" },
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: {
        code: "permission_denied",
        message: e.message ?? "Mattermost auth/permission error",
      },
    };
  }
  if (status === 400) {
    return {
      ok: false,
      error: { code: "invalid_request", message: e.message ?? "Mattermost rejected request" },
    };
  }
  return {
    ok: false,
    error: {
      code: "send_failed",
      message: e.message ?? (err instanceof Error ? err.message : String(err)),
    },
  };
}

/**
 * Escape the characters this platform would otherwise parse as markup.
 *
 * Called only when the caller declared `format: "plain"` — an explicit statement that the text
 * is NOT markup. Without it, a user's literal `*asterisks*` render as italic on a platform that
 * parses markdown natively, which is the caller's intent being silently inverted.
 *
 * Deliberately narrow: the four characters that open an inline span. A full markdown escaper
 * would also touch `#`, `>` and `-` at line starts, which are far more common in ordinary prose
 * and whose escaping is more visible than the problem it solves.
 */
function escapeMarkdown(text: string): string {
  // The backslash comes FIRST, and that ordering is the whole correctness of this function.
  // Without it a backslash already in the caller's text is left bare: `a\*b` escapes to `a\\*b`,
  // the renderer consumes `\\` as one literal backslash, and the `*` it was guarding is left
  // naked — so text sent explicitly as `plain` arrives italicised, the exact inversion this
  // function exists to prevent. Caught in review.
  return text.replace(/([\\*_`~])/g, "\\$1");
}
