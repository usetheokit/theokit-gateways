/**
 * Options and seams for `SignalAdapter`.
 *
 * @public
 */

import type { Readable, Writable } from "node:stream";

/**
 * The part of a child process the adapter uses: its three pipes, `kill`, and the `exit` and
 * `error` events. `node:child_process` `spawn` returns a superset of it.
 *
 * @public
 */
export interface ChildLike {
  /** The child's standard input; the adapter writes one JSON-RPC request per line. */
  readonly stdin: Writable;
  /** The child's standard output; one JSON-RPC message per line. */
  readonly stdout: Readable;
  /** The child's standard error; drained so the pipe never fills. */
  readonly stderr: Readable;
  /** Signal the child to end. */
  kill(signal?: NodeJS.Signals | number): boolean;
  /** Fires once the child has ended and its pipes are closed, with its exit code or signal. */
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  /** Fires when the child cannot be started or signalled (`ENOENT` for a missing binary). */
  on(event: "error", listener: (err: Error) => void): this;
}

/**
 * Starts a child process. The default is `node:child_process` `spawn` with all three pipes;
 * tests pass a scripted child instead.
 *
 * @public
 */
export type SpawnLike = (command: string, args: readonly string[]) => ChildLike;

/**
 * Construction options for `SignalAdapter`.
 *
 * The adapter holds no secret: signal-cli keeps the account's keys in its own data directory,
 * which is why there is no credential field here.
 *
 * @public
 */
export interface SignalAdapterOptions {
  /**
   * The Signal account the adapter speaks as, the phone number registered or linked to
   * signal-cli, in E.164 form (`+5511999990000`). Passed to signal-cli as `-a <account>`.
   */
  readonly account: string;
  /** Path or name of the signal-cli binary. Default `"signal-cli"`, looked up on `PATH`. */
  readonly signalCliPath?: string;
  /** signal-cli's data directory, passed as `--config <configDir>`. Default: signal-cli's own. */
  readonly configDir?: string;
  /** How long `connect()` waits for signal-cli to answer `listGroups`. Default 10000 ms. */
  readonly connectTimeoutMs?: number;
  /** How long a `send` may stay unanswered before it fails with `timeout`. Default 30000 ms. */
  readonly requestTimeoutMs?: number;
  /** Test seam: starts the child. Default `node:child_process` `spawn`. */
  readonly spawn?: SpawnLike;
}
