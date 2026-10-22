/**
 * `GoogleChatAdapter` — `BasePlatformAdapter` over Google Chat's HTTP interaction endpoint and
 * REST API.
 *
 * Chat posts each interaction to the app's HTTPS endpoint with a Google-signed bearer token; the
 * adapter verifies it with keys it reads itself (FR-025, FR-026) and answers within the request.
 * Replies go out through `spaces.messages.create`, authorised by a token the adapter obtains for
 * its service account (FR-028).
 *
 * @public
 */

import { createPrivateKey, type KeyObject } from "node:crypto";

import {
  BasePlatformAdapter,
  channelRendering,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { AccessTokenClient, AccessTokenError } from "./access-token.js";
import { googleKeySet, type KeySet } from "./key-set.js";
import { chatEventToMessageEvent, type GoogleChatEventBody } from "./normalize.js";
import type { FetchLike, GoogleChatAdapterOptions } from "./types.js";
import { verifyChatRequest } from "./verify-token.js";
import { createWebhookServer, type WebhookServer } from "./webhook-server.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const CHAT_API = "https://chat.googleapis.com/v1";
const SPACE_NAME = /^spaces\/[A-Za-z0-9_-]+$/;
const LABEL = "gateway-google-chat";

/** What the webhook route needs from the adapter: one answer per request. */
export interface GoogleChatInbound {
  handleRequest(
    authorization: string | undefined,
    rawBody: string,
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }>;
}

/**
 * Google Chat adapter for one Chat app.
 *
 * `connect()` obtains an access token for the service account and starts the webhook listener;
 * it answers `false`, never a throw, when the key is unreadable, the token exchange fails, or no
 * token arrives within `connectTimeoutMs`.
 *
 * @public
 */
export class GoogleChatAdapter extends BasePlatformAdapter implements GoogleChatInbound {
  readonly platform = "google_chat" as const;
  private readonly opts: GoogleChatAdapterOptions;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly keySet: KeySet;
  private tokens: AccessTokenClient | undefined;
  private server: WebhookServer | undefined;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  /** Bumped by `disconnect()`, so a connect that was overtaken by one gives up its listener. */
  private generation = 0;
  private warnedAboutHtml = false;

  constructor(opts: GoogleChatAdapterOptions) {
    super();
    this.opts = opts;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.keySet = googleKeySet({ fetch: this.fetchFn, now: this.now });
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    // A second caller while the first is still connecting shares its answer instead of starting
    // a second token exchange and a second listener on the same port.
    this.connecting ??= this.openSession().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.connected = false;
    const server = this.server;
    this.server = undefined;
    await server?.stop();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!SPACE_NAME.test(out.channel.id)) {
      return {
        ok: false,
        error: {
          code: "invalid_space",
          message: `channel.id must be a space name, spaces/<id>, got "${out.channel.id}"`,
        },
      };
    }
    const tokens = this.tokens;
    if (!this.connected || tokens === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "GoogleChatAdapter.connect() has not succeeded" },
      };
    }
    let token: string;
    try {
      token = await tokens.token();
    } catch (err) {
      return { ok: false, error: { code: "google_chat_auth_error", message: message(err) } };
    }
    return this.post(out.channel.id, this.textFor(out), token);
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

  /**
   * Deliver an event that arrived out of band. One line over `runHandler`, which owns the
   * containment of a throwing handler.
   */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  /**
   * Answer one request Chat posted: verify its token, then hand a `MESSAGE` event to the handler.
   * The handler runs after the answer, so a slow one never makes Chat wait or retry.
   */
  async handleRequest(
    authorization: string | undefined,
    rawBody: string,
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
    const verdict = await verifyChatRequest(authorization, {
      keySet: this.keySet,
      audience: this.opts.audience,
      now: this.now,
    });
    if (!verdict.ok) {
      process.stderr.write(`[${LABEL}] refused a request (${verdict.status}): ${verdict.reason}\n`);
      return { status: verdict.status, body: { error: verdict.reason } };
    }
    let body: GoogleChatEventBody;
    try {
      body = JSON.parse(rawBody) as GoogleChatEventBody;
    } catch {
      return { status: 400, body: { error: "the body is not JSON" } };
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { status: 400, body: { error: "the body is not a JSON object" } };
    }
    const event = chatEventToMessageEvent(body, this.now());
    if (event === undefined) return { status: 200, body: {} };
    // No handler means nobody would see the message: a 503 makes Chat report the failure rather
    // than count the message as delivered.
    if (this.handler === undefined) return { status: 503, body: { error: "no handler" } };
    void this.deliver(event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${message(err)}\n`);
    });
    return { status: 200, body: {} };
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and Google Chat has no html mode; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  private async post(space: string, text: string, token: string): Promise<SendResult> {
    let response: Response;
    try {
      response = await this.fetchFn(`${CHAT_API}/${space}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch (err) {
      return { ok: false, error: { code: "google_chat_http_error", message: message(err) } };
    }
    const answer = (await response.json().catch(() => undefined)) as { name?: unknown } | undefined;
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: "google_chat_http_error",
          message: `Chat API answered HTTP ${response.status}`,
        },
      };
    }
    return typeof answer?.name === "string" ? { ok: true, messageId: answer.name } : { ok: true };
  }

  /** The token client for the configured key, or `undefined` when the key cannot be read. */
  private tokenClient(): AccessTokenClient | undefined {
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey(this.opts.privateKey.replaceAll("\\n", "\n"));
    } catch (err) {
      process.stderr.write(
        `[${LABEL}] connect failed: privateKey is not a PEM key: ${message(err)}\n`,
      );
      return undefined;
    }
    return new AccessTokenClient({
      serviceAccountEmail: this.opts.serviceAccountEmail,
      privateKey,
      fetch: this.fetchFn,
      now: this.now,
    });
  }

  /**
   * Obtain the first token, then start the listener. A `disconnect()` that lands while either is
   * pending wins: the listener is stopped again and the answer is `false`.
   */
  private async openSession(): Promise<boolean> {
    const generation = this.generation;
    const tokens = this.tokenClient();
    if (tokens === undefined) return false;
    if (!(await this.firstToken(tokens))) return false;
    if (generation !== this.generation) return overtaken();
    let server: WebhookServer;
    try {
      server = await createWebhookServer({
        adapter: this,
        ...(this.opts.path === undefined ? {} : { path: this.opts.path }),
        ...(this.opts.port === undefined ? {} : { port: this.opts.port }),
      });
      await server.start();
    } catch (err) {
      process.stderr.write(`[${LABEL}] connect failed: listener did not start: ${message(err)}\n`);
      return false;
    }
    if (generation !== this.generation) {
      await server.stop();
      return overtaken();
    }
    this.server = server;
    this.tokens = tokens;
    this.connected = true;
    return true;
  }

  /** Whether the first token arrives within `connectTimeoutMs`; the exchange is aborted if not. */
  private async firstToken(tokens: AccessTokenClient): Promise<boolean> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([tokens.token(controller.signal), deadline]);
      if (outcome === "timeout") {
        process.stderr.write(`[${LABEL}] connect failed: no access token in time\n`);
        return false;
      }
      return true;
    } catch (err) {
      const why = err instanceof AccessTokenError ? err.message : message(err);
      process.stderr.write(`[${LABEL}] connect failed: ${why}\n`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

function overtaken(): false {
  process.stderr.write(
    `[${LABEL}] connect failed: disconnect() was called before connect finished\n`,
  );
  return false;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
