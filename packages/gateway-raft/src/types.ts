/**
 * Options and process seam of `RaftAdapter`.
 *
 * @public
 */

import type { Readable, Writable } from "node:stream";

/** The part of a child process the adapter uses. */
export interface RaftChild {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin: Writable;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

/** Starts a process; the adapter's only seam to the Raft CLI. @public */
export type RaftSpawn = (command: string, args: readonly string[]) => RaftChild;

/** Options for `RaftAdapter`. No secret: the Raft CLI holds its own login. @public */
export interface RaftAdapterOptions {
  /** The Raft CLI, `raft` on the PATH by default. */
  readonly command?: string;
  /** Arguments that make the CLI stay running and print one JSON wake per line. Default `["wake", "--json"]`. */
  readonly wakeArgs?: readonly string[];
  /** Arguments of the reply command for a conversation; the text goes on its stdin. Default `["reply", "--to", id]`. */
  readonly replyArgs?: (conversationId: string) => readonly string[];
  /** Milliseconds a reply may take. Default 30000. */
  readonly replyTimeoutMs?: number;
  /** Test seam; defaults to `node:child_process` `spawn`. */
  readonly spawn?: RaftSpawn;
}
