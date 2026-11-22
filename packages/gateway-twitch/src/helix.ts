/**
 * The Twitch HTTP calls: the token validator, EventSub subscriptions and Send Chat Message.
 */

import { type SendError, sendErrorFromHttp } from "@theokit/gateway";

import type { FetchLike } from "./types.js";

const VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const HELIX = "https://api.twitch.tv/helix";

/** What the validator says about the token. */
export type TokenCheck =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly clientId: string;
      readonly scopes: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** The answer to one Send Chat Message call. */
export type ChatSend =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly error: SendError };

/** One message to send. */
export interface ChatMessage {
  readonly broadcasterId: string;
  readonly senderId: string;
  readonly text: string;
  readonly replyTo?: string;
}

interface SendBody {
  readonly data?: ReadonlyArray<{
    readonly message_id?: string;
    readonly is_sent?: boolean;
    readonly drop_reason?: { readonly message?: string } | null;
  }>;
}

/** Calls to Twitch with one user access token. */
export class HelixClient {
  private clientId = "";

  constructor(
    private readonly token: string,
    private readonly fetchFn: FetchLike,
  ) {}

  /** Validate the token; Helix calls need the client id it names. */
  async validate(signal: AbortSignal): Promise<TokenCheck> {
    const response = await this.fetchFn(VALIDATE_URL, {
      headers: { authorization: `OAuth ${this.token}` },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: `the token validator answered HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      user_id?: unknown;
      client_id?: unknown;
      scopes?: unknown;
    };
    if (typeof body.user_id !== "string" || typeof body.client_id !== "string") {
      return { ok: false, reason: "the token validator named no user or client" };
    }
    this.clientId = body.client_id;
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((s): s is string => typeof s === "string")
      : [];
    return { ok: true, userId: body.user_id, clientId: body.client_id, scopes };
  }

  /** Subscribe the EventSub session to one channel's chat; the HTTP status (202 is success). */
  async subscribe(
    sessionId: string,
    broadcasterId: string,
    botUserId: string,
    signal: AbortSignal,
  ): Promise<number> {
    const response = await this.fetchFn(`${HELIX}/eventsub/subscriptions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: broadcasterId, user_id: botUserId },
        transport: { method: "websocket", session_id: sessionId },
      }),
      signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  }

  /** Send one chat message. */
  async sendChat(message: ChatMessage, signal: AbortSignal): Promise<ChatSend> {
    let response: Response;
    try {
      response = await this.fetchFn(`${HELIX}/chat/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          broadcaster_id: message.broadcasterId,
          sender_id: message.senderId,
          message: message.text,
          ...(message.replyTo === undefined ? {} : { reply_parent_message_id: message.replyTo }),
        }),
        signal,
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: "network_error", message: why } };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const { error } = sendErrorFromHttp(response.status, String(response.status), {
        retryAfter: response.headers.get("retry-after"),
        platformCode: "twitch_api_error",
      });
      return {
        ok: false,
        error: error ?? { code: "platform_error", message: String(response.status) },
      };
    }
    const first = ((await response.json()) as SendBody).data?.[0];
    if (first?.is_sent === true) return { ok: true, messageId: first.message_id ?? "" };
    return {
      ok: false,
      error: {
        code: "twitch_message_dropped",
        message: first?.drop_reason?.message ?? "Twitch did not send the message",
      },
    };
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      "client-id": this.clientId,
      "content-type": "application/json",
    };
  }
}
