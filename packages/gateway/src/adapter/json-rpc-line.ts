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
 * @public
 */

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** The child process shape the client drives: its three pipes, `kill`, and `close`/`error` events. */
export interface JsonRpcChild {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
}

/** How one request ended. Never a rejection: every outcome is a value the caller maps. */
export type RpcOutcome =
  | { readonly kind: "result"; readonly result: unknown }
  | {
      readonly kind: "error";
      readonly code: number;
      readonly message: string;
      readonly data?: unknown;
    }
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
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
}

/** Parse one stdout line into a message object, or `undefined` for anything else. */
function parseMessage(line: string, onSkip: (excerpt: string) => void): RpcMessage | undefined {
  if (line.trim() === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    onSkip(line.slice(0, 120));
    return undefined;
  }
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  return isObject ? (value as RpcMessage) : undefined;
}

/** Map a response message to the outcome it carries. */
function outcomeOf(message: RpcMessage): RpcOutcome {
  const { error } = message;
  if (error === undefined) return { kind: "result", result: message.result };
  return {
    kind: "error",
    code: error.code ?? 0,
    message: error.message ?? "unknown JSON-RPC error",
    ...(error.data === undefined ? {} : { data: error.data }),
  };
}

/** Line-framed JSON-RPC over one child. Dead once the child exits or `close()` is called. */
export class JsonRpcLineClient {
  private counter = 0;
  private readonly pending = new Map<number, Pending>();
  private alive = true;

  /**
   * @param child - the running child; the client attaches to its pipes and events
   * @param label - the stderr tag, e.g. `gateway-signal`
   * @param onNotification - called for every message that carries a method and no id
   * @param onClosed - called once, when the child exits or fails
   */
  constructor(
    private readonly child: JsonRpcChild,
    private readonly label: string,
    private readonly onNotification: (notification: RpcNotification) => void,
    private readonly onClosed: (reason: string) => void,
  ) {
    const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.resume();
    child.stdin.on("error", (err: Error) => this.close(`stdin: ${err.message}`));
    child.on("error", (err: Error) => this.close(err.message));
    // `close`, not `exit`: `exit` can fire before stdout has drained, which would settle a request
    // whose answer is still in the pipe as `disconnected`.
    child.on("close", (code, signal) => this.close(`exited with ${signal ?? `code ${code}`}`));
  }

  /** Send `method` and wait for its answer, at most `timeoutMs`. */
  request(method: string, params: unknown, timeoutMs: number): Promise<RpcOutcome> {
    if (!this.alive || !this.child.stdin.writable) return Promise.resolve({ kind: "disconnected" });
    this.counter += 1;
    const id = this.counter;
    const frame = `${JSON.stringify({ jsonrpc: "2.0", method, params, id })}\n`;
    return new Promise<RpcOutcome>((resolve) => {
      const timer = setTimeout(() => this.settle(id, { kind: "timeout" }), timeoutMs);
      this.pending.set(id, { settle: resolve, timer });
      this.child.stdin.write(frame, (err) => {
        if (err) this.close(`stdin: ${err.message}`);
      });
    });
  }

  /** Settle every pending request as `disconnected` and stop accepting new ones. Idempotent. */
  close(reason: string): void {
    if (!this.alive) return;
    this.alive = false;
    for (const id of Array.from(this.pending.keys())) this.settle(id, { kind: "disconnected" });
    this.onClosed(reason);
  }

  private settle(id: number, outcome: RpcOutcome): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.settle(outcome);
  }

  private handleLine(line: string): void {
    if (!this.alive) return;
    const message = parseMessage(line, (excerpt) => {
      process.stderr.write(`[${this.label}] skipped a stdout line that is not JSON: ${excerpt}\n`);
    });
    if (message === undefined) return;
    const { id, method } = message;
    if (typeof method === "string" && (id === undefined || id === null)) {
      this.onNotification({ method, params: message.params });
    } else if (typeof id === "number") {
      this.settle(id, outcomeOf(message));
    }
  }
}
