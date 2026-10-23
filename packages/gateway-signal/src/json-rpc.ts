/**
 * A JSON-RPC 2.0 client over a child's stdio, one message per line.
 *
 * signal-cli's `jsonRpc` mode reads requests on stdin and writes responses and notifications on
 * stdout. Two failure paths here would otherwise end the host process, and both were measured:
 * an `EPIPE` on a stdin the child already closed, raised as an `error` event nobody listens to,
 * and a `JSON.parse` throw on a stray log line inside a stream listener. The first is listened
 * to and the second is caught and reported, so a dying or noisy child costs its own requests and
 * nothing else.
 *
 * @internal
 */

import { createInterface } from "node:readline";

import type { ChildLike } from "./types.js";

/** How one request ended. Never a rejection: every outcome is a value the caller maps. */
export type RpcOutcome =
  | { readonly kind: "result"; readonly result: unknown }
  | { readonly kind: "error"; readonly code: number; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "disconnected" };

/** A server-to-client message with no id. */
export interface RpcNotification {
  readonly method: string;
  readonly params: unknown;
}

interface Pending {
  readonly settle: (outcome: RpcOutcome) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface RpcMessage {
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

/** Line-framed JSON-RPC over one child. Dead once the child exits or `close()` is called. */
export class JsonRpcLineClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private open = true;

  /**
   * @param child - the running child; the client attaches to its pipes and events
   * @param label - the stderr tag, e.g. `gateway-signal`
   * @param onNotification - called for every message that carries a method and no id
   * @param onClosed - called once, when the child exits or fails
   */
  constructor(
    private readonly child: ChildLike,
    private readonly label: string,
    private readonly onNotification: (notification: RpcNotification) => void,
    private readonly onClosed: (reason: string) => void,
  ) {
    createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on(
      "line",
      (line) => this.onLine(line),
    );
    child.stderr.resume();
    child.stdin.on("error", (err: Error) => this.close(`stdin: ${err.message}`));
    child.on("error", (err: Error) => this.close(err.message));
    // `close`, not `exit`: `exit` can fire before stdout has drained, which would settle a request
    // whose answer is still in the pipe as `disconnected`.
    child.on("close", (code, signal) => this.close(`exited with ${signal ?? `code ${code}`}`));
  }

  /** Send `method` and wait for its answer, at most `timeoutMs`. */
  request(method: string, params: unknown, timeoutMs: number): Promise<RpcOutcome> {
    if (!this.open || !this.child.stdin.writable) return Promise.resolve({ kind: "disconnected" });
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<RpcOutcome>((resolve) => {
      const timer = setTimeout(() => this.settle(id, { kind: "timeout" }), timeoutMs);
      this.pending.set(id, { settle: resolve, timer });
      const line = `${JSON.stringify({ jsonrpc: "2.0", method, params, id })}\n`;
      this.child.stdin.write(line, (err) => {
        if (err) this.close(`stdin: ${err.message}`);
      });
    });
  }

  /** Settle every pending request as `disconnected` and stop accepting new ones. Idempotent. */
  close(reason: string): void {
    if (!this.open) return;
    this.open = false;
    for (const id of [...this.pending.keys()]) this.settle(id, { kind: "disconnected" });
    this.onClosed(reason);
  }

  private settle(id: number, outcome: RpcOutcome): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.settle(outcome);
  }

  private onLine(line: string): void {
    if (!this.open || line.trim() === "") return;
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      process.stderr.write(
        `[${this.label}] skipped a stdout line that is not JSON: ${line.slice(0, 120)}\n`,
      );
      return;
    }
    if (typeof message.method === "string" && (message.id === undefined || message.id === null)) {
      this.onNotification({ method: message.method, params: message.params });
      return;
    }
    if (typeof message.id !== "number") return;
    if (message.error !== undefined) {
      this.settle(message.id, {
        kind: "error",
        code: message.error.code ?? 0,
        message: message.error.message ?? "unknown JSON-RPC error",
      });
      return;
    }
    this.settle(message.id, { kind: "result", result: message.result });
  }
}
