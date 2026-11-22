/**
 * `IMessageAdapter` — `BasePlatformAdapter` over `imsg rpc`.
 *
 * The adapter owns one `imsg` child. Requests go out on its stdin, and responses and `message`
 * notifications come back on its stdout, one JSON line each. `imsg` sends as the account signed
 * in to Messages on its Mac, so the adapter carries no secret.
 *
 * @public
 */

import { spawn as nodeSpawn } from "node:child_process";

import {
  BasePlatformAdapter,
  channelRendering,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { mapSendError } from "./errors.js";
import { JsonRpcLineClient, type RpcNotification, type RpcOutcome } from "./json-rpc.js";
import { type IMessageRow, imessageRowToMessageEvent } from "./normalize.js";
import { refuseAttachments } from "./refuse-attachments.js";
import type { ChildLike, IMessageAdapterOptions, SpawnLike } from "./types.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** How long `disconnect()` lets `imsg` end on its own after stdin closes, before `SIGTERM`. */
const EXIT_GRACE_MS = 2_000;
const CHAT_ID = /^[1-9]\d*$/;
const LABEL = "gateway-imessage";

const defaultSpawn: SpawnLike = (command, args) =>
  nodeSpawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });

/** One running `imsg rpc`. */
interface Session {
  readonly child: ChildLike;
  readonly rpc: JsonRpcLineClient;
  /** Set once the session is ended: resolves when the child closed or was signalled. */
  ended?: Promise<void>;
}

/**
 * iMessage adapter over one `imsg rpc` child.
 *
 * `connect()` starts `imsg rpc` and answers `true` once it accepts `watch.subscribe`. Each
 * `message` notification from someone else, with text, becomes an `IMessageMessageEvent`;
 * `sendMessage` writes one `send` request and maps its answer to a `SendResult`.
 *
 * @public
 */
export class IMessageAdapter extends BasePlatformAdapter {
  readonly platform = "imessage" as const;
  private readonly opts: IMessageAdapterOptions;
  private session: Session | undefined;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private warnedAboutHtml = false;
  private connecting: Promise<boolean> | undefined;
  /** The last row whose turn finished; a new subscription resumes after it. */
  private lastRowId: number | undefined;
  /**
   * Rows wait here for the one before them, across sessions: a row replayed by a new child waits
   * for the old child's row still in its handler, then finds the cursor past it.
   */
  private rows: Promise<void> = Promise.resolve();

  constructor(opts: IMessageAdapterOptions) {
    super();
    this.opts = opts;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    // A second caller while the first waits for watch.subscribe shares its answer instead of
    // starting a second imsg, which would deliver every message twice.
    this.connecting ??= this.openSession().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    this.endSession(session);
    await session.ended;
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    const chatId = toChatId(out.channel.id);
    if (chatId === undefined) {
      return {
        ok: false,
        error: {
          code: "invalid_chat_id",
          message: `channel.id must be imsg's chat id, a positive integer, got "${out.channel.id}"`,
        },
      };
    }
    const session = this.session;
    if (!this.connected || session === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "IMessageAdapter.connect() has not succeeded" },
      };
    }
    const outcome = await session.rpc.request(
      "send",
      { chat_id: chatId, text: this.textFor(out) },
      this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    return this.toSendResult(outcome, session);
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

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and iMessage has no html mode; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  private toSendResult(outcome: RpcOutcome, session: Session): SendResult {
    switch (outcome.kind) {
      case "result":
        return sentResult(outcome.result);
      case "error": {
        const mapped = mapSendError(outcome.code, outcome.message, outcome.data);
        if (mapped.endChild) this.endSession(session);
        return mapped.result;
      }
      case "timeout":
        return {
          ok: false,
          error: { code: "timeout", message: "imsg did not answer the send in time" },
        };
      case "disconnected":
        return {
          ok: false,
          error: { code: "transport_closed", message: "imsg ended before answering the send" },
        };
    }
  }

  /** Start imsg and subscribe; on any failure the child is ended and `false` returned. */
  private async openSession(): Promise<boolean> {
    const session = this.startChild();
    if (session === undefined) return false;
    const outcome = await session.rpc.request(
      "watch.subscribe",
      this.lastRowId === undefined ? {} : { since_rowid: this.lastRowId },
      this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    );
    if (outcome.kind === "result" && this.session === session) {
      this.connected = true;
      return true;
    }
    process.stderr.write(`[${LABEL}] connect failed: ${describe(outcome)}\n`);
    // The answer is false now; the child's grace period runs on its own.
    if (this.session === session) this.endSession(session);
    return false;
  }

  /** Start imsg and attach the line client, or `undefined` when it cannot be started. */
  private startChild(): Session | undefined {
    const args = ["rpc", ...(this.opts.dbPath === undefined ? [] : ["--db", this.opts.dbPath])];
    let child: ChildLike;
    try {
      child = (this.opts.spawn ?? defaultSpawn)(this.opts.cliPath ?? "imsg", args);
    } catch (err) {
      process.stderr.write(`[${LABEL}] connect failed: could not start imsg: ${message(err)}\n`);
      return undefined;
    }
    const rpc: JsonRpcLineClient = new JsonRpcLineClient(
      child,
      LABEL,
      (notification) => this.onNotification(session, notification),
      (reason) => this.onChildClosed(session, reason),
    );
    const session: Session = { child, rpc };
    this.session = session;
    return session;
  }

  /**
   * End a session: settle its pending requests, close imsg's stdin and give it `EXIT_GRACE_MS`
   * to exit before `SIGTERM`. `session.ended` resolves once the child closed or was signalled.
   * Idempotent.
   */
  private endSession(session: Session): void {
    if (this.session === session) {
      this.session = undefined;
      this.connected = false;
    }
    if (session.ended !== undefined) return;
    session.rpc.close("disconnected");
    session.ended = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        session.child.kill("SIGTERM");
        resolve();
      }, EXIT_GRACE_MS);
      timer.unref?.();
      session.child.on("close", (code, signal) => {
        clearTimeout(timer);
        process.stderr.write(`[${LABEL}] imsg exited with ${signal ?? `code ${code}`}\n`);
        resolve();
      });
      session.child.stdin.end();
    });
  }

  private onChildClosed(session: Session, reason: string): void {
    if (this.session !== session) return;
    process.stderr.write(`[${LABEL}] imsg ${reason}\n`);
    this.session = undefined;
    this.connected = false;
  }

  private onNotification(session: Session, notification: RpcNotification): void {
    if (notification.method !== "message") return;
    const row = (notification.params as { message?: IMessageRow } | undefined)?.message;
    if (row === undefined) return;
    // One row at a time, in the order imsg wrote them, so the cursor only ever covers rows
    // whose turn has finished.
    this.rows = this.rows
      .then(() => this.handleRow(session, row))
      .catch((err: unknown) => {
        process.stderr.write(`[${LABEL}] handler threw: ${message(err)}\n`);
      });
  }

  /**
   * Hand one row to the handler, then move the cursor past it. A row that found no handler does
   * not move the cursor; the next subscription asks for it again unless a later row of the same
   * session was handled first and moved the cursor past both.
   */
  private async handleRow(session: Session, row: IMessageRow): Promise<void> {
    // A row queued behind one that was running when imsg died is not started: the next
    // subscription replays it from the cursor.
    if (this.session !== session) return;
    const rowId = typeof row.id === "number" ? row.id : undefined;
    if (rowId !== undefined && this.lastRowId !== undefined && rowId <= this.lastRowId) return;
    const event = imessageRowToMessageEvent(row, Date.now());
    const outcome = event === undefined ? "ok" : await this.runHandler(this.handler, event);
    if (rowId !== undefined && outcome !== "no_handler") {
      this.lastRowId = Math.max(rowId, this.lastRowId ?? rowId);
    }
  }
}

/** A successful send: the guid, else the numeric row id, else no `messageId` at all. */
function sentResult(result: unknown): SendResult {
  const fields = (typeof result === "object" && result !== null ? result : {}) as {
    guid?: unknown;
    id?: unknown;
  };
  if (typeof fields.guid === "string") return { ok: true, messageId: fields.guid };
  if (typeof fields.id === "number") return { ok: true, messageId: String(fields.id) };
  return { ok: true };
}

/** `imsg`'s chat id from a `channel.id`, or `undefined` when it is not a positive integer. */
function toChatId(id: string): number | undefined {
  if (!CHAT_ID.test(id)) return undefined;
  const chatId = Number(id);
  return Number.isSafeInteger(chatId) ? chatId : undefined;
}

function describe(outcome: RpcOutcome): string {
  if (outcome.kind === "error")
    return `watch.subscribe answered ${outcome.code}: ${outcome.message}`;
  if (outcome.kind === "timeout") return "watch.subscribe was not answered in time";
  return "imsg ended before answering watch.subscribe";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
