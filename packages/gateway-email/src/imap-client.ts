/**
 * IMAP client wrapper around `imapflow`. Supports IDLE + polling fallback.
 *
 * @internal
 */

import { type FetchMessageObject, ImapFlow } from "imapflow";

/**
 * Sentinel runtime export — workaround for rollup-plugin-dts deep type-only
 * re-export bug. The marker is INTENTIONALLY orphan: it forces rollup-plugin-dts
 * to keep the module in the bundle so re-exports from `index.ts` resolve.
 *
 * @knipignore
 */
export const __imapMarker: unique symbol = Symbol("imap");

interface ImapClientConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly auth: { user: string; pass: string };
}

export interface FetchedMessage {
  readonly uid: number;
  readonly source: Buffer;
  readonly headers: Map<string, string>;
}

export interface MailboxStatus {
  readonly uidValidity: number;
  readonly uidNext: number;
}

export interface IImapClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Capability check — does the server advertise IDLE? */
  supportsIdle(): boolean;
  /** The open mailbox's UIDVALIDITY and UIDNEXT: the baseline a first connect records (#348). */
  mailboxStatus(): Promise<MailboxStatus>;
  /**
   * Fetch UNSEEN messages once, only those with `uid >= sinceUid` when given. Used for poll +
   * post-IDLE-event drain.
   */
  fetchUnseen(sinceUid?: number): Promise<FetchedMessage[]>;
  /**
   * Set `\Seen` on the server for a whole batch, so `fetchUnseen()` stops
   * returning them.
   *
   * The server flag is the only delivery state that survives a restart, which
   * is what issue #11 turned on: the in-memory UID set is cleared by
   * `disconnect()`, so without this a reconnect re-delivers the whole unread
   * backlog to the handler.
   *
   * Batched, not per-message, and the reason is measured rather than stylistic.
   * The first version flagged each message individually from inside the
   * serialized dispatch queue; against a 166-message backlog on a real mailbox
   * that put 166 sequential round trips ahead of every newly-arrived message,
   * and an inbound probe waited past 120s to be delivered. One command per
   * drain removes that queue entirely.
   */
  markSeen(uids: readonly number[]): Promise<void>;
  /** Start IDLE; invoke `onExists` whenever the server pushes a new-message notification. */
  startIdle(onExists: () => void): Promise<void>;
  /** Stop IDLE if running. */
  stopIdle(): Promise<void>;
}

export class ImapClient implements IImapClient {
  private client: ImapFlow | undefined;
  private idleAbort: AbortController | undefined;

  constructor(private readonly config: ImapClientConfig) {}

  async connect(): Promise<void> {
    this.client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
      logger: false,
    });
    await this.client.connect();
    await this.client.mailboxOpen("INBOX");
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async mailboxStatus(): Promise<MailboxStatus> {
    const box = this.client?.mailbox;
    if (box === undefined || box === false) throw new Error("no mailbox open");
    return { uidValidity: Number(box.uidValidity), uidNext: box.uidNext };
  }

  supportsIdle(): boolean {
    if (this.client === undefined) return false;
    const caps = (this.client as unknown as { capabilities?: { has?: (s: string) => boolean } })
      .capabilities;
    return caps?.has?.("IDLE") ?? false;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: shape-mapping function — imapflow can hand headers as Map OR Buffer depending on protocol path; this is the single normalization site.
  async fetchUnseen(sinceUid?: number): Promise<FetchedMessage[]> {
    if (this.client === undefined) return [];
    const out: FetchedMessage[] = [];
    const query = sinceUid === undefined ? { seen: false } : { seen: false, uid: `${sinceUid}:*` };
    for await (const raw of this.client.fetch(query, {
      uid: true,
      source: true,
      headers: true,
    } as Parameters<ImapFlow["fetch"]>[1])) {
      const msg = raw as FetchMessageObject;
      const headers = new Map<string, string>();
      // headers is a Buffer/Map in imapflow; handle both shapes safely.
      const h = (msg as unknown as { headers?: unknown }).headers;
      if (h instanceof Map) {
        for (const [k, v] of h as Map<string, string | string[]>) {
          headers.set(String(k), Array.isArray(v) ? (v[0] ?? "") : v);
        }
      } else if (h instanceof Buffer) {
        for (const line of h.toString("utf8").split(/\r?\n/)) {
          const idx = line.indexOf(":");
          if (idx > 0)
            headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
        }
      }
      if (msg.uid !== undefined && msg.source !== undefined) {
        out.push({
          uid: msg.uid,
          source: msg.source as Buffer,
          headers,
        });
      }
    }
    return out;
  }

  async markSeen(uids: readonly number[]): Promise<void> {
    if (this.client === undefined || uids.length === 0) return;
    // `uid: true` is load-bearing — without it imapflow reads these numbers as
    // sequence numbers, which are positional and shift as the mailbox changes,
    // so the flags would land on whatever messages happen to sit at those slots.
    await this.client.messageFlagsAdd({ uid: uids.join(",") }, ["\\Seen"], { uid: true });
  }

  async startIdle(onExists: () => void): Promise<void> {
    if (this.client === undefined) return;
    this.idleAbort = new AbortController();
    const c = this.client;
    // imapflow's `c.idle()` resolves when IDLE ends. The `mailbox.on("exists")`
    // event fires inside IDLE. We register the listener once and let imapflow
    // refresh IDLE internally per RFC 2177.
    c.on("exists", () => {
      onExists();
    });
    void c.idle().catch(() => {
      /* idle aborted */
    });
  }

  async stopIdle(): Promise<void> {
    if (this.idleAbort !== undefined) {
      this.idleAbort.abort();
      this.idleAbort = undefined;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopIdle();
    if (this.client !== undefined) {
      try {
        await this.client.logout();
      } catch {
        /* ignore */
      }
      this.client = undefined;
    }
  }
}
