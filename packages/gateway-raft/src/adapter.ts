/**
 * `RaftAdapter` — `BasePlatformAdapter` over the Raft CLI wake bridge.
 *
 * The adapter owns one long-running `raft wake --json` child: each JSON line it prints is a wake
 * of the agent from Raft and becomes one event. A reply runs `raft reply --to <conversation>`
 * with the text on stdin and succeeds on exit code 0. The CLI holds its own Raft login, so the
 * adapter carries no secret.
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

import { refuseAttachments } from "./refuse-attachments.js";
import type { RaftAdapterOptions, RaftChild, RaftSpawn } from "./types.js";
import { parseRaftWake } from "./wake.js";

const LABEL = "gateway-raft";
const DEFAULT_REPLY_TIMEOUT_MS = 30_000;

const defaultSpawn: RaftSpawn = (command, args) =>
  nodeSpawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });

/**
 * Raft External Agent adapter.
 *
 * `connect()` starts the wake child and answers `true` once the process has started, `false` when
 * the CLI cannot be run. If the child exits later the adapter is disconnected and `sendMessage`
 * answers `not_connected`; call `connect()` again to resume.
 *
 * @public
 */
export class RaftAdapter extends BasePlatformAdapter {
  readonly platform = "raft" as const;
  private readonly command: string;
  private readonly spawnFn: RaftSpawn;
  private readonly opts: RaftAdapterOptions;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private wake: RaftChild | undefined;
  private connected = false;
  /** Wakes run one after another, in the order Raft printed them. */
  private queue: Promise<void> = Promise.resolve();
  private readonly seen = new Set<string>();

  constructor(opts: RaftAdapterOptions = {}) {
    super();
    this.opts = opts;
    this.command = opts.command ?? "raft";
    this.spawnFn = opts.spawn ?? defaultSpawn;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    const child = this.spawnFn(this.command, this.opts.wakeArgs ?? ["wake", "--json"]);
    const started = await new Promise<boolean>((resolve) => {
      child.on("error", (err) => {
        process.stderr.write(`[${LABEL}] ${this.command} failed: ${err.message}\n`);
        if (this.wake === child) this.drop();
        resolve(false);
      });
      child.on("close", (code) => {
        if (this.wake === child) this.drop();
        process.stderr.write(`[${LABEL}] wake bridge exited with ${String(code)}\n`);
        resolve(false);
      });
      // A process that spawned has no error within this tick; an absent binary reports ENOENT
      // asynchronously, so give that event one macrotask before calling it started.
      setTimeout(() => resolve(true), 50);
    });
    if (!started) return false;
    this.wake = child;
    this.connected = true;
    child.stderr.on("data", () => undefined);
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line !== "") this.enqueue(line);
        nl = buffer.indexOf("\n");
      }
    });
    return true;
  }

  async disconnect(): Promise<void> {
    const child = this.wake;
    this.drop();
    child?.kill("SIGTERM");
    await this.queue;
  }

  private drop(): void {
    this.wake = undefined;
    this.connected = false;
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
        error: { code: "not_connected", message: "RaftAdapter.connect() has not succeeded" },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a Raft conversation id" },
      };
    }
    const text =
      out.format === "markdown" ? channelRendering(this.platform).translate(out.text) : out.text;
    return this.reply(out.channel.id, text);
  }

  private reply(conversation: string, text: string): Promise<SendResult> {
    const args = this.opts.replyArgs?.(conversation) ?? ["reply", "--to", conversation];
    const timeoutMs = this.opts.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
    return new Promise<SendResult>((resolve) => {
      let child: RaftChild;
      let stderr = "";
      let done = false;
      const finish = (result: SendResult): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result);
      };
      const fail = (message: string): void =>
        finish({ ok: false, error: { code: "raft_send_failed", message } });
      const timer = setTimeout(() => {
        child?.kill("SIGTERM");
        fail(`raft reply timed out after ${timeoutMs} ms`);
      }, timeoutMs);
      try {
        child = this.spawnFn(this.command, args);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        return;
      }
      child.on("error", (err) => fail(err.message));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c: string) => {
        if (stderr.length < 500) stderr += c;
      });
      child.on("close", (code) =>
        code === 0
          ? finish({ ok: true, messageId: "" }) // the CLI prints no message id
          : fail(`raft reply exited with ${String(code)}${stderr ? `: ${stderr.trim()}` : ""}`),
      );
      child.stdin.on("error", (err) => fail(err.message));
      child.stdin.end(text);
    });
  }

  private enqueue(line: string): void {
    this.queue = this.queue.then(() => this.handleLine(line));
  }

  private async handleLine(line: string): Promise<void> {
    const event = parseRaftWake(line);
    if (event === undefined) {
      process.stderr.write(`[${LABEL}] dropped a wake line that is not a usable wake\n`);
      return;
    }
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 1000) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    const outcome = await this.runHandler(this.handler, event);
    if (outcome === "handler_threw") process.stderr.write(`[${LABEL}] handler threw\n`);
  }
}
