/**
 * Scripted Twitch for the tests: EventSub WebSocket sessions and Helix over a fake `fetch`. Frame
 * and body shapes follow the EventSub WebSocket and Helix references
 * (https://dev.twitch.tv/docs/eventsub/handling-websocket-events/,
 * https://dev.twitch.tv/docs/api/reference/#send-chat-message).
 */

import type { FetchLike, TwitchSocket } from "../src/types.js";

export const TOKEN = "abcdefghijklmnopqrstuvwxyz0123";
export const BOT = "1001";
export const BROADCASTER = "2002";

/** One EventSub connection, with controls for Twitch's side. */
export class FakeSocket implements TwitchSocket {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  send(): void {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** Twitch drops the connection. */
  drop(): void {
    this.close();
  }

  frame(messageType: string, payload: unknown, extra: Record<string, unknown> = {}): void {
    this.onmessage?.({
      data: JSON.stringify({
        metadata: { message_id: `m-${Math.random()}`, message_type: messageType, ...extra },
        payload,
      }),
    });
  }

  welcome(sessionId: string, keepalive = 10): void {
    this.onopen?.();
    this.frame("session_welcome", {
      session: {
        id: sessionId,
        status: "connected",
        keepalive_timeout_seconds: keepalive,
        reconnect_url: null,
      },
    });
  }

  keepalive(): void {
    this.frame("session_keepalive", {});
  }

  chat(opts: { messageId: string; chatter?: string; text?: string }): void {
    this.frame(
      "notification",
      {
        subscription: {
          type: "channel.chat.message",
          condition: { broadcaster_user_id: BROADCASTER },
        },
        event: {
          broadcaster_user_id: BROADCASTER,
          chatter_user_id: opts.chatter ?? "3003",
          chatter_user_login: "viewer",
          message_id: `chat-${opts.messageId}`,
          message: { text: opts.text ?? "hello" },
        },
      },
      { message_id: opts.messageId, subscription_type: "channel.chat.message" },
    );
  }

  reconnectTo(url: string): void {
    this.frame("session_reconnect", {
      session: {
        id: "s-old",
        status: "reconnecting",
        keepalive_timeout_seconds: null,
        reconnect_url: url,
      },
    });
  }

  revoke(status: string): void {
    this.frame("revocation", {
      subscription: {
        type: "channel.chat.message",
        status,
        condition: { broadcaster_user_id: BROADCASTER, user_id: BOT },
      },
    });
  }
}

/** Every socket opened, in order. */
export class FakeSockets {
  readonly opened: FakeSocket[] = [];

  readonly factory = (url: string): FakeSocket => {
    const socket = new FakeSocket(url);
    this.opened.push(socket);
    return socket;
  };

  latest(): FakeSocket {
    const socket = this.opened.at(-1);
    if (socket === undefined) throw new Error("no socket was opened");
    return socket;
  }
}

/** Helix and the token validator, answering what the test sets. */
export class FakeHelix {
  scopes = ["user:read:chat", "user:write:chat"];
  validateStatus = 200;
  userId = BOT;
  subscribeStatus: (broadcaster: string) => number = () => 202;
  send: (body: Record<string, unknown>) => Promise<Response> = async () =>
    Response.json({ data: [{ message_id: `sent-${this.sent.length}`, is_sent: true }] });
  readonly subscriptions: Array<Record<string, unknown>> = [];
  readonly sent: Array<Record<string, unknown>> = [];
  readonly headers: Headers[] = [];

  readonly fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    this.headers.push(new Headers(init?.headers));
    if (url.pathname === "/oauth2/validate") {
      if (this.validateStatus !== 200) return new Response(null, { status: this.validateStatus });
      return Response.json({
        client_id: "client-x",
        login: "bot",
        scopes: this.scopes,
        user_id: this.userId,
        expires_in: 3600,
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.pathname === "/helix/eventsub/subscriptions") {
      this.subscriptions.push(body);
      const condition = body.condition as { broadcaster_user_id: string };
      return new Response(null, { status: this.subscribeStatus(condition.broadcaster_user_id) });
    }
    if (url.pathname === "/helix/chat/messages") {
      this.sent.push(body);
      return waitOrAbort(this.send(body), init?.signal);
    }
    return new Response(null, { status: 404 });
  };
}

function waitOrAbort(
  answer: Promise<Response>,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (signal === null || signal === undefined) return answer;
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
    answer.then(resolve, reject);
  });
}
