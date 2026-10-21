/**
 * Options and seams for `IMessageAdapter`.
 *
 * @public
 */

import type { Readable, Writable } from "node:stream";

/**
 * The part of a child process the adapter uses: its three pipes, `kill`, and the `close` and
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
 * Construction options for `IMessageAdapter`.
 *
 * The adapter holds no secret: `imsg` reads the Messages database and sends as the account
 * signed in to Messages on its Mac, which is why there is no credential field here.
 *
 * @public
 */
export interface IMessageAdapterOptions {
  /**
   * Path or name of the `imsg` binary, or of a script that runs `imsg rpc` on a Mac over ssh.
   * Default `"imsg"`, looked up on `PATH`.
   */
  readonly cliPath?: string;
  /** Messages database to read, passed as `--db <dbPath>`. Default: `imsg`'s own. */
  readonly dbPath?: string;
  /** How long `connect()` waits for `imsg` to answer `watch.subscribe`. Default 10000 ms. */
  readonly connectTimeoutMs?: number;
  /** How long a `send` may stay unanswered before it fails with `timeout`. Default 30000 ms. */
  readonly requestTimeoutMs?: number;
  /** Test seam: starts the child. Default `node:child_process` `spawn`. */
  readonly spawn?: SpawnLike;
}
