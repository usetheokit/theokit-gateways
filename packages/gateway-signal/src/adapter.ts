/**
 * `SignalAdapter` — `BasePlatformAdapter` over `signal-cli jsonRpc`.
 *
 * The adapter owns one signal-cli child. Requests go out on its stdin and responses and
 * `receive` notifications come back on its stdout, one JSON line each. signal-cli holds the
 * account's keys in its own data directory, so the adapter carries no secret.
 *
 * @public
 */

import { spawn as nodeSpawn } from "node:child_process";

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { JsonRpcLineClient, type RpcNotification, type RpcOutcome } from "./json-rpc.js";
import { GROUP_PREFIX, type SignalEnvelope, signalEnvelopeToMessageEvent } from "./normalize.js";
import { toTextStyle } from "./text-style.js";
import type { ChildLike, SignalAdapterOptions, SpawnLike } from "./types.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const E164 = /^\+[1-9]\d{6,14}$/;
const LABEL = "gateway-signal";

const defaultSpawn: SpawnLike = (command, args) =>
  nodeSpawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });

/**
 * Signal adapter over one `signal-cli jsonRpc` child.
 *
 * `connect()` starts signal-cli for `account` and answers `true` once it replies to
 * `listGroups`. Each `receive` notification with message text becomes a `SignalMessageEvent`;
 * `sendMessage` writes one `send` request and maps its answer to a `SendResult`.
 *
 * @public
 */
export class SignalAdapter extends BasePlatformAdapter {
  readonly platform = "signal" as const;
  private readonly opts: SignalAdapterOptions;
  private child: ChildLike | undefined;
  private rpc: JsonRpcLineClient | undefined;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private warnedAboutHtml = false;
  private connecting: Promise<boolean> | undefined;

  /**
   * @throws Error when `account` is not an E.164 number; a wrong account is a programmer error
   *   and signal-cli would only report it after starting.
   */
  constructor(opts: SignalAdapterOptions) {
    super();
    if (!E164.test(opts.account)) {
      throw new Error(
        `${LABEL}: opts.account must be the registered number in E.164 form (e.g. "+5511999990000"), got "${opts.account}"`,
      );
    }
    this.opts = opts;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    // A second caller while the first is still waiting for listGroups shares its answer instead
    // of starting a second signal-cli, which would be left running and deliver every message twice.
    this.connecting ??= this.openSession().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.endChild();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected || this.rpc === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "SignalAdapter.connect() has not succeeded" },
      };
    }
    const target =
      out.channel.type === "dm"
        ? { recipient: [out.channel.id] }
        : { groupId: withoutGroupPrefix(out.channel.id) };
    const outcome = await this.rpc.request(
      "send",
      { ...target, ...this.body(out) },
      this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    return toSendResult(outcome);
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

  /** `message`, plus `textStyle` when the caller declared markdown. */
  private body(out: OutboundMessage): { message: string; textStyle?: readonly string[] } {
    if (out.format === "markdown") {
      const styled = toTextStyle(out.text);
      return styled.textStyle.length === 0
        ? { message: styled.message }
        : { message: styled.message, textStyle: styled.textStyle };
    }
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and Signal has no html mode; sending the text unchanged. Logged once.\n`,
      );
    }
    return { message: out.text };
  }

  /** Start signal-cli and wait for `listGroups`; on any failure the child is ended. */
  private async openSession(): Promise<boolean> {
    const rpc = this.startChild();
    if (rpc === undefined) return false;
    const outcome = await rpc.request(
      "listGroups",
      {},
      this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    );
    if (outcome.kind === "result" && this.rpc === rpc) {
      this.connected = true;
      return true;
    }
    process.stderr.write(`[${LABEL}] connect failed: ${describe(outcome)}\n`);
    if (this.rpc === rpc) this.endChild();
    return false;
  }

  /** Start signal-cli and attach the line client, or `undefined` when it cannot be started. */
  private startChild(): JsonRpcLineClient | undefined {
    const args = [
      "-a",
      this.opts.account,
      ...(this.opts.configDir === undefined ? [] : ["--config", this.opts.configDir]),
      "jsonRpc",
    ];
    let child: ChildLike;
    try {
      child = (this.opts.spawn ?? defaultSpawn)(this.opts.signalCliPath ?? "signal-cli", args);
    } catch (err) {
      process.stderr.write(
        `[${LABEL}] connect failed: could not start signal-cli: ${message(err)}\n`,
      );
      return undefined;
    }
    const rpc = new JsonRpcLineClient(
      child,
      LABEL,
      (notification) => this.onNotification(notification),
      (reason) => this.onChildClosed(rpc, reason),
    );
    this.child = child;
    this.rpc = rpc;
    return rpc;
  }

  /** Close the line client (settling every pending request) and stop the child. Idempotent. */
  private endChild(): void {
    const child = this.child;
    const rpc = this.rpc;
    this.child = undefined;
    this.rpc = undefined;
    this.connected = false;
    rpc?.close("disconnected");
    if (child !== undefined) {
      child.stdin.end();
      child.kill("SIGTERM");
    }
  }

  private onChildClosed(rpc: JsonRpcLineClient, reason: string): void {
    if (this.rpc !== rpc) return;
    process.stderr.write(`[${LABEL}] signal-cli ${reason}\n`);
    this.child = undefined;
    this.rpc = undefined;
    this.connected = false;
  }

  private onNotification(notification: RpcNotification): void {
    if (notification.method !== "receive") return;
    const envelope = (notification.params as { envelope?: SignalEnvelope } | undefined)?.envelope;
    if (envelope === undefined) return;
    const event = signalEnvelopeToMessageEvent(envelope, Date.now());
    if (event === undefined) return;
    void this.runHandler(this.handler, event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${message(err)}\n`);
    });
  }
}

function toSendResult(outcome: RpcOutcome): SendResult {
  switch (outcome.kind) {
    case "result": {
      const timestamp = (outcome.result as { timestamp?: unknown } | undefined)?.timestamp;
      return typeof timestamp === "number"
        ? { ok: true, messageId: String(timestamp) }
        : { ok: true };
    }
    case "error":
      return { ok: false, error: { code: "signal_rpc_error", message: outcome.message } };
    case "timeout":
      return {
        ok: false,
        error: { code: "timeout", message: "signal-cli did not answer the send in time" },
      };
    case "disconnected":
      return { ok: false, error: { code: "disconnected", message: "signal-cli is not running" } };
  }
}

/** A group's `channel.id` carries the `group.` prefix inbound events give it; signal-cli does not. */
function withoutGroupPrefix(id: string): string {
  return id.startsWith(GROUP_PREFIX) ? id.slice(GROUP_PREFIX.length) : id;
}

function describe(outcome: RpcOutcome): string {
  if (outcome.kind === "error") return `listGroups answered ${outcome.code}: ${outcome.message}`;
  if (outcome.kind === "timeout") return "listGroups was not answered in time";
  return "signal-cli ended before answering listGroups";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
