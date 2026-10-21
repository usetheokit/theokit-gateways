/**
 * A scripted signal-cli child: real streams, no process.
 *
 * The adapter talks to its child through stdin and stdout only, so a test drives it the way
 * signal-cli would, one JSON line at a time, and reads back every line the adapter wrote.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { ChildLike, SpawnLike } from "../src/types.js";

/** One request line the adapter wrote to the child's stdin, parsed. */
export interface WrittenRequest {
  readonly jsonrpc: string;
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export class FakeChild extends EventEmitter implements ChildLike {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly written: WrittenRequest[] = [];
  killed = false;
  private buffered = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.buffered += chunk.toString("utf8");
      let newline = this.buffered.indexOf("\n");
      while (newline !== -1) {
        const line = this.buffered.slice(0, newline);
        this.buffered = this.buffered.slice(newline + 1);
        if (line.trim() !== "") this.written.push(JSON.parse(line) as WrittenRequest);
        newline = this.buffered.indexOf("\n");
      }
    });
  }

  /** Write one raw line to the adapter, as signal-cli would print it. */
  emitLine(line: string): void {
    this.stdout.write(`${line}\n`);
  }

  /** Answer the request with `id` with a JSON-RPC result. */
  answer(id: number | string, result: unknown): void {
    this.emitLine(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  /** Answer the request with `id` with a JSON-RPC error. */
  fail(id: number | string, code: number, message: string): void {
    this.emitLine(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  /** Push a `receive` notification carrying `envelope`. */
  receive(envelope: Record<string, unknown>): void {
    this.emitLine(
      JSON.stringify({ jsonrpc: "2.0", method: "receive", params: { envelope, account: "+1" } }),
    );
  }

  /** The latest request the adapter wrote for `method`. */
  last(method: string): WrittenRequest | undefined {
    return this.written.filter((r) => r.method === method).at(-1);
  }

  /** End the process: stdout closes, then `exit` and `close` fire, as a dying signal-cli does. */
  exit(code: number | null = 1, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    queueMicrotask(() => this.exit(null, typeof signal === "string" ? signal : "SIGTERM"));
    return true;
  }
}

/** A spawn seam that records every launch and hands out `FakeChild`s. */
export function fakeSpawn(): {
  spawn: SpawnLike;
  children: FakeChild[];
  calls: Array<{ command: string; args: readonly string[] }>;
} {
  const children: FakeChild[] = [];
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const spawn: SpawnLike = (command, args) => {
    calls.push({ command, args });
    const child = new FakeChild();
    children.push(child);
    return child;
  };
  return { spawn, children, calls };
}

/** Wait until `check` holds, polling the event loop; fails naming what never happened. */
export async function until(check: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}
