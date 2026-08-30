/**
 * `EmailAdapter` integration tests (T6.1 + EC-1/EC-3/EC-4/EC-5/EC-6 absorption).
 *
 * Uses fake `IImapClient` + `ISmtpClient` injected via `__imapFactory` / `__smtpFactory`.
 */

import { BasePlatformAdapter, type MessageEvent } from "@theokit/gateway";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailAdapter } from "../src/adapter.js";
import type { FetchedMessage, IImapClient } from "../src/imap-client.js";
import type { ISmtpClient, SmtpSendOptions } from "../src/smtp-client.js";

const VALID_OPTS = {
  address: "bot@example.com",
  password: "secret",
  imapHost: "imap.example.com",
  smtpHost: "smtp.example.com",
};

function rfc5322(opts: {
  from: string;
  to?: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  body?: string;
  autoSubmitted?: string;
}): Buffer {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to ?? "bot@example.com"}`,
    `Subject: ${opts.subject ?? "Test"}`,
    `Message-ID: <${opts.messageId ?? "msg-1@example.com"}>`,
  ];
  if (opts.inReplyTo !== undefined) lines.push(`In-Reply-To: <${opts.inReplyTo}>`);
  if (opts.references !== undefined) lines.push(`References: ${opts.references}`);
  if (opts.autoSubmitted !== undefined) lines.push(`Auto-Submitted: ${opts.autoSubmitted}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(opts.body ?? "Hello bot");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

class FakeImap implements IImapClient {
  connected = false;
  idleEnabled = true;
  idleOn = false;
  onExists?: () => void;
  queue: FetchedMessage[] = [];
  connectError?: Error;
  // eslint-disable-next-line @typescript-eslint/require-await
  async connect(): Promise<void> {
    if (this.connectError !== undefined) throw this.connectError;
    this.connected = true;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async disconnect(): Promise<void> {
    this.connected = false;
    this.idleOn = false;
  }
  supportsIdle(): boolean {
    return this.idleEnabled;
  }
  /**
   * UIDs the adapter has flagged \Seen on the "server".
   *
   * This fake used to model `fetchUnseen()` as draining its queue: fetch once
   * and the message was gone forever. No IMAP server behaves that way — a
   * message stays UNSEEN until something sets the flag — and that gap is
   * precisely why 686 unit tests were green while a bot re-answered its whole
   * unread inbox on every reconnect (issue #11). A fake that forgets cannot
   * catch a bug about not remembering.
   */
  seen = new Set<number>();
  markSeenError?: Error;
  // eslint-disable-next-line @typescript-eslint/require-await
  async fetchUnseen(): Promise<FetchedMessage[]> {
    return this.queue.filter((m) => !this.seen.has(m.uid));
  }
  /** One entry per markSeen call — proves batching, not just correctness. */
  markSeenCalls: number[][] = [];
  // eslint-disable-next-line @typescript-eslint/require-await
  async markSeen(uids: readonly number[]): Promise<void> {
    if (this.markSeenError !== undefined) throw this.markSeenError;
    this.markSeenCalls.push([...uids]);
    for (const uid of uids) this.seen.add(uid);
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async startIdle(onExists: () => void): Promise<void> {
    this.onExists = onExists;
    this.idleOn = true;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async stopIdle(): Promise<void> {
    this.idleOn = false;
  }
  /** Test helper: enqueue a message; tests call adapter._drainNow() to consume. */
  push(msg: FetchedMessage): void {
    this.queue.push(msg);
  }
}

class FakeSmtp implements ISmtpClient {
  sent: SmtpSendOptions[] = [];
  verifyError?: Error;
  sendError?: Error;
  returnId = "outbound-1@example.com";
  // eslint-disable-next-line @typescript-eslint/require-await
  async verify(): Promise<true> {
    if (this.verifyError !== undefined) throw this.verifyError;
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async send(opts: SmtpSendOptions): Promise<string> {
    if (this.sendError !== undefined) throw this.sendError;
    this.sent.push(opts);
    return this.returnId;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    /* noop */
  }
}

function mk(extra: Partial<typeof VALID_OPTS> & Record<string, unknown> = {}) {
  const imap = new FakeImap();
  const smtp = new FakeSmtp();
  // How many times connect() built its clients. `connect()` is guarded by `this.connected`, so this
  // counter is the only place the difference between "the guard held" and "the guard latched" is
  // visible from outside: both leave connect() answering true.
  const built = { imap: 0, smtp: 0 };
  const adapter = new EmailAdapter({
    ...VALID_OPTS,
    ...extra,
    __imapFactory: () => {
      built.imap += 1;
      return imap;
    },
    __smtpFactory: () => {
      built.smtp += 1;
      return smtp;
    },
  });
  return { adapter, imap, smtp, built };
}

describe("EmailAdapter", () => {
  // These two spies were installed and never read. Silencing a log is not the same as checking it,
  // and here it hid the sharper problem below: `expect(received.length).toBe(0)` cannot tell a
  // message the FILTER dropped from one that never arrived — a parse failure, a drain that threw,
  // an adapter that stopped fetching. Both give zero. The warn line naming the filter is the only
  // thing that separates them, and it was going into a spy nobody looked at.
  let warned: string[] = [];
  let errored: string[] = [];
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const logOf = (xs: string[]): string => xs.join("\n");
  beforeEach(() => {
    warned = [];
    errored = [];
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((...a: unknown[]) => void warned.push(a.map(String).join(" ")));
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void errored.push(a.map(String).join(" ")));
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("test_adapter_is_base_platform_adapter", () => {
    const { adapter } = mk();
    expect(adapter).toBeInstanceOf(BasePlatformAdapter);
  });

  it("test_adapter_platform_is_email", () => {
    const { adapter } = mk();
    expect(adapter.platform).toBe("email");
  });

  describe("constructor", () => {
    for (const key of ["address", "password", "imapHost", "smtpHost"] as const) {
      // The message, not just the type: all four fields raise the SAME TypeError from the same loop,
      // so the type alone would still pass if the check reported the wrong field — and the field name
      // is the entire content of the diagnostic for whoever mis-configured the adapter.
      const named = new RegExp(`^EmailAdapter: ${key} is required and must be a non-empty string$`);
      it(`throws TypeError when ${key} is empty`, () => {
        expect(() => {
          new EmailAdapter({ ...VALID_OPTS, [key]: "" });
        }).toThrow(named);
      });
      it(`throws TypeError when ${key} is missing`, () => {
        const opts = { ...VALID_OPTS } as Record<string, string>;
        delete opts[key];
        expect(() => {
          // @ts-expect-error — deliberately invalid
          new EmailAdapter(opts);
        }).toThrow(named);
      });
    }
  });

  describe("connect", () => {
    it("registers IDLE when supported", async () => {
      const { adapter, imap } = mk();
      const ok = await adapter.connect();
      expect(ok).toBe(true);
      expect(imap.idleOn).toBe(true);
      await adapter.disconnect();
    });

    it("falls back to poll when IDLE unsupported", async () => {
      const { adapter, imap } = mk({ pollIntervalMs: 50 });
      imap.idleEnabled = false;
      const ok = await adapter.connect();
      expect(ok).toBe(true);
      expect(imap.idleOn).toBe(false);
      await adapter.disconnect();
    });

    it("returns false on connect failure (D172 contract)", async () => {
      const { adapter, imap } = mk();
      imap.connectError = new Error("network unreachable");
      const ok = await adapter.connect();
      expect(ok).toBe(false);
      // `false` is the contract; the reason is what an operator has to act on. Without this, a
      // connect that fails silently is indistinguishable from one that reports why.
      expect(logOf(errored), "connect failed without saying why").toContain("network unreachable");
    });

    it("returns false on SMTP verify failure", async () => {
      const { adapter, smtp } = mk();
      smtp.verifyError = new Error("auth bad");
      const ok = await adapter.connect();
      expect(ok).toBe(false);
      expect(logOf(errored), "SMTP verify failed without saying why").toContain("auth bad");
    });

    it("is idempotent — second connect returns true without reinit", async () => {
      const { adapter, built } = mk();
      await adapter.connect();
      const ok2 = await adapter.connect();
      expect(ok2).toBe(true);

      // "without reinit" is the half the assertion above cannot see: a second connect that DID
      // rebuild both clients also answers true, and would leak an IMAP connection per call.
      expect(built, "connect() rebuilt its clients on the second call").toEqual({
        imap: 1,
        smtp: 1,
      });
      await adapter.disconnect();
    });

    it("reconnects after an explicit disconnect", async () => {
      // The guard must be a guard, not a latch. `disconnect()` clears `connected`, and if it ever
      // stops doing so, connect() returns true without building anything — the adapter goes deaf
      // with no error anywhere. Removing that one line leaves the whole suite green without this.
      const { adapter, built } = mk();
      await adapter.connect();
      await adapter.disconnect();
      await adapter.connect();

      expect(built, "the second connect() did not rebuild its clients").toEqual({
        imap: 2,
        smtp: 2,
      });
      await adapter.disconnect();
    });
  });

  describe("disconnect", () => {
    it("is idempotent before connect", async () => {
      const { adapter } = mk();
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it("clears seen + thread state", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      imap.push({
        uid: 1,
        source: rfc5322({ from: "alice@x.com", messageId: "m1@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(adapter._seenUidsSize).toBe(1);
      expect(adapter._threadStoreSize).toBe(1);
      await adapter.disconnect();
      expect(adapter._seenUidsSize).toBe(0);
      expect(adapter._threadStoreSize).toBe(0);
    });
  });

  describe("inbound dispatch", () => {
    it("test_dispatch_drops_own_address_loopback (EC-1 CRITICAL)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      // Own-address loopback: From: bot@example.com (same as adapter address).
      imap.push({
        uid: 10,
        source: rfc5322({ from: "bot@example.com", messageId: "loop@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      // ...and dropped BY THE LOOPBACK FILTER. Zero deliveries is also what a parse failure or a
      // dead drain produces, and either would make this test green while the guard was gone.
      expect(logOf(warned), "nothing was dropped by the loopback filter").toContain("loopback");
      // Thread store also untouched.
      expect(adapter._threadStoreSize).toBe(0);
      await adapter.disconnect();
    });

    it("drops loopback even when From: has display-name + brackets", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 11,
        source: rfc5322({
          from: '"Bot" <bot@example.com>',
          messageId: "loop2@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      await adapter.disconnect();
    });

    it("filters automated senders by Auto-Submitted header", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      const headers = new Map([["auto-submitted", "auto-generated"]]);
      imap.push({
        uid: 20,
        source: rfc5322({
          from: "noreply@external.com",
          messageId: "auto@x.com",
        }),
        headers,
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      await adapter.disconnect();
    });

    it("filters noreply From: address", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 21,
        source: rfc5322({
          from: "noreply@external.com",
          messageId: "nr@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      await adapter.disconnect();
    });

    it("allows automated when allowAutomated: true", async () => {
      const { adapter, imap } = mk({ allowAutomated: true });
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 22,
        source: rfc5322({
          from: "noreply@external.com",
          messageId: "auto2@x.com",
        }),
        headers: new Map([["auto-submitted", "auto-generated"]]),
      });
      await adapter._drainNow();
      expect(received.length).toBe(1);
      await adapter.disconnect();
    });

    it("test_dispatch_filters_disallowed_senders (EC-3 allowlist)", async () => {
      const { adapter, imap } = mk({ allowedSenders: ["alice@x.com"] });
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 30,
        source: rfc5322({ from: "bob@x.com", messageId: "bob@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(0);
      expect(logOf(warned), "bob was not dropped by the allowlist").toContain(
        "sender not in allowlist: bob@x.com",
      );
      await adapter.disconnect();
    });

    it("EC-3 allows bracketed allowedSenders entry to match pure-address From:", async () => {
      const { adapter, imap } = mk({
        allowedSenders: ['"Alice" <alice@x.com>'],
      });
      await adapter.connect();
      const received: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        received.push(e);
      });
      imap.push({
        uid: 31,
        source: rfc5322({ from: "alice@x.com", messageId: "a1@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(received.length).toBe(1);
      await adapter.disconnect();
    });

    it("test_dispatch_records_thread_context", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      imap.push({
        uid: 40,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Hello",
          messageId: "thread-a@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(adapter._threadStoreSize).toBe(1);
      await adapter.disconnect();
    });

    it("dedups by seen UID (no double dispatch)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      let count = 0;
      adapter.onInbound(async () => {
        count++;
      });
      const msg: FetchedMessage = {
        uid: 50,
        source: rfc5322({ from: "alice@x.com", messageId: "dup@x.com" }),
        headers: new Map(),
      };
      imap.push(msg);
      await adapter._drainNow();
      imap.push(msg);
      await adapter._drainNow();
      expect(count).toBe(1);
      await adapter.disconnect();
    });

    it("test_dispatch_serializes_concurrent_calls (EC-4)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const order: number[] = [];
      adapter.onInbound(async (e) => {
        // Race: each dispatch sleeps based on uid. Without serialization,
        // smaller-sleep uids would resolve out of order.
        const event = e as MessageEvent & { email: { messageId: string } };
        const uidStr = event.email.messageId.split("-")[1] ?? "0";
        const uid = Number.parseInt(uidStr, 10);
        await new Promise((r) => setTimeout(r, uid === 1 ? 30 : 5));
        order.push(uid);
      });
      // Fire two concurrent IDLE events. With EC-4, first must finish before second.
      imap.push({
        uid: 1,
        source: rfc5322({ from: "alice@x.com", messageId: "id-1@x.com" }),
        headers: new Map(),
      });
      imap.push({
        uid: 2,
        source: rfc5322({ from: "alice@x.com", messageId: "id-2@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(order).toEqual([1, 2]);
      await adapter.disconnect();
    });
  });

  describe("onInbound", () => {
    it("test_oninbound_replaces (EC-H pattern)", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const first: MessageEvent[] = [];
      const second: MessageEvent[] = [];
      adapter.onInbound(async (e) => {
        first.push(e);
      });
      adapter.onInbound(async (e) => {
        second.push(e);
      });
      imap.push({
        uid: 70,
        source: rfc5322({ from: "alice@x.com", messageId: "rep@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(first.length).toBe(0);
      expect(second.length).toBe(1);
      await adapter.disconnect();
    });

    it("returned unsubscribe clears handler", async () => {
      const { adapter, imap } = mk();
      await adapter.connect();
      const got: MessageEvent[] = [];
      const off = adapter.onInbound(async (e) => {
        got.push(e);
      });
      off();
      imap.push({
        uid: 71,
        source: rfc5322({ from: "alice@x.com", messageId: "off@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(got.length).toBe(0);
      await adapter.disconnect();
    });

    it("a stale unsubscribe does not clear the handler that replaced it", async () => {
      // The sequence that broke: onInbound(A) -> onInbound(B) -> A's unsubscribe.
      // Without an identity guard, A's closure cleared B and inbound delivery
      // stopped for good, silently. Eight of the ten adapters guarded against
      // this; email and teams did not, and no test anywhere ran this order —
      // both existing unsubscribe tests were subscribe-then-unsubscribe.
      const { adapter, imap } = mk();
      await adapter.connect();
      const first: MessageEvent[] = [];
      const second: MessageEvent[] = [];
      const offFirst = adapter.onInbound(async (e) => {
        first.push(e);
      });
      adapter.onInbound(async (e) => {
        second.push(e);
      });

      offFirst(); // stale: it belongs to a handler that is no longer installed

      imap.push({
        uid: 72,
        source: rfc5322({ from: "alice@x.com", messageId: "stale@x.com" }),
        headers: new Map(),
      });
      await adapter._drainNow();
      expect(first.length).toBe(0);
      expect(second.length).toBe(1);
      await adapter.disconnect();
    });
  });

  describe("sendMessage", () => {
    it("rejects empty text without hitting SMTP", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      const res = await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm" },
        text: "",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error?.code).toBe("empty_text");
      expect(smtp.sent.length).toBe(0);
      await adapter.disconnect();
    });

    it("rejects when not connected", async () => {
      const { adapter } = mk();
      const res = await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error?.code).toBe("not_connected");
    });

    it("returns messageId on success", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      smtp.returnId = "new-out-1@example.com";
      const res = await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi alice",
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.messageId).toBe("new-out-1@example.com");
      expect(smtp.sent.length).toBe(1);
      await adapter.disconnect();
    });

    it("uses default subject when no topicId", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      expect(smtp.sent[0]?.subject).toBe("Message from agent");
      expect(smtp.sent[0]?.inReplyTo).toBeUndefined();
      expect(smtp.sent[0]?.references).toBeUndefined();
      await adapter.disconnect();
    });

    it("prepends Re: when replying into a thread", async () => {
      const { adapter, imap, smtp } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      imap.push({
        uid: 80,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Hello",
          messageId: "t1@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm", topicId: "t1@x.com" },
        text: "reply",
      });
      expect(smtp.sent[0]?.subject).toBe("Re: Hello");
      expect(smtp.sent[0]?.inReplyTo).toBe("t1@x.com");
      await adapter.disconnect();
    });

    it("does not double-prepend Re: on an already-Re: subject", async () => {
      const { adapter, imap, smtp } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      imap.push({
        uid: 81,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Re: Hello",
          messageId: "t2@x.com",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm", topicId: "t2@x.com" },
        text: "reply2",
      });
      expect(smtp.sent[0]?.subject).toBe("Re: Hello");
      await adapter.disconnect();
    });

    it("test_send_references_dedup (EC-6)", async () => {
      const { adapter, imap, smtp } = mk();
      await adapter.connect();
      adapter.onInbound(async () => {});
      // Inbound message with references chain that already includes the messageId.
      imap.push({
        uid: 82,
        source: rfc5322({
          from: "alice@x.com",
          subject: "Hi",
          messageId: "t3@x.com",
          references: "<orig@x.com> <t3@x.com>",
        }),
        headers: new Map(),
      });
      await adapter._drainNow();
      await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm", topicId: "t3@x.com" },
        text: "reply",
      });
      const refs = smtp.sent[0]?.references;
      expect(refs).toBeDefined();
      // No duplicates.
      const set = new Set(refs);
      expect(set.size).toBe(refs?.length);
      // t3@x.com appears exactly once.
      expect(refs?.filter((r) => r === "t3@x.com").length).toBe(1);
      await adapter.disconnect();
    });

    it("maps SMTP auth failure to auth_failed", async () => {
      const { adapter, smtp } = mk();
      await adapter.connect();
      smtp.sendError = Object.assign(new Error("Auth bad"), { code: "EAUTH" });
      const res = await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error?.code).toBe("auth_failed");
      await adapter.disconnect();
    });

    it("formats From: as name+address when fromName provided", async () => {
      const { adapter, smtp } = mk({ fromName: "TheoBot" });
      await adapter.connect();
      await adapter.sendMessage({
        channel: { id: "alice@x.com", type: "dm" },
        text: "hi",
      });
      const from = smtp.sent[0]?.from;
      expect(from).toEqual({ name: "TheoBot", address: "bot@example.com" });
      await adapter.disconnect();
    });
  });

  describe("durable delivery state (issue #11)", () => {
    it("delivers a message once across a reconnect", async () => {
      // THE regression. `seenUids` is in-memory and `disconnect()` clears it,
      // so the only thing that can stop a redelivery after a restart is a flag
      // on the server. Without one, a bot with N unread answers all N senders
      // again every time it reconnects — and it answers by email, which nobody
      // can recall.
      const { adapter, imap } = mk();
      const received: string[] = [];
      const handler = async (e: { text: string }): Promise<void> => {
        received.push(e.text);
      };

      imap.push({
        uid: 1,
        source: rfc5322({ from: "alice@x.com", messageId: "m1@x.com" }),
        headers: new Map(),
      });

      adapter.onInbound(handler);
      await adapter.connect();
      await adapter._drainNow();
      expect(received).toHaveLength(1);

      await adapter.disconnect();
      // Re-registering is not ceremony: `disconnect()` clears the handler
      // (adapter.ts:132), so an app that reconnects has to hand it back. The
      // first draft of this test skipped this line and passed while the bug was
      // still present — the redelivery happened, found no handler, and vanished.
      // A green test that proves the handler was cleared is not a test of
      // delivery.
      adapter.onInbound(handler);
      await adapter.connect();
      await adapter._drainNow();

      expect(received).toHaveLength(1);
      await adapter.disconnect();
    });

    it("flags a dropped own-address message too, so it stops being refetched", async () => {
      // EC-1 discards these before the handler, but discarding is not the same
      // as finishing with them: left UNSEEN they are downloaded and re-parsed
      // on every single drain forever. Most of the 166-message backlog measured
      // on the live mailbox was exactly this — old probes the adapter kept
      // reading and throwing away.
      const { adapter, imap } = mk();
      imap.push({
        uid: 7,
        source: rfc5322({ from: "bot@example.com", messageId: "loop@x.com" }),
        headers: new Map(),
      });
      await adapter.connect();
      await adapter._drainNow();

      expect(imap.seen.has(7)).toBe(true);
      expect(await imap.fetchUnseen()).toHaveLength(0);
      await adapter.disconnect();
    });

    it("flags a whole drain with ONE server command, not one per message", async () => {
      // Not a style preference — a measurement. Flagging per message from
      // inside the serialized dispatch queue put 166 sequential round trips
      // ahead of every newly-arrived message on the live mailbox, and an
      // inbound probe waited past 120s to reach the handler. If someone ever
      // "simplifies" this back to a call per message, this test is what says
      // why they should not.
      const { adapter, imap } = mk();
      for (const uid of [11, 12, 13, 14, 15]) {
        imap.push({
          uid,
          source: rfc5322({ from: "alice@x.com", messageId: `m${uid}@x.com` }),
          headers: new Map(),
        });
      }
      await adapter.connect();
      await adapter._drainNow();

      expect(imap.markSeenCalls).toHaveLength(1);
      expect(imap.markSeenCalls[0]).toEqual([11, 12, 13, 14, 15]);
      await adapter.disconnect();
    });

    it("still delivers when the server refuses to set the flag", async () => {
      // Failing to mark must not cost the message. The worst case is that it
      // comes back on the next drain, which is today's behaviour and strictly
      // better than dropping mail a user sent.
      const { adapter, imap } = mk();
      imap.markSeenError = new Error("[NOPERM] read-only mailbox");
      const received: string[] = [];
      adapter.onInbound(async (e) => {
        received.push(e.text);
      });
      imap.push({
        uid: 3,
        source: rfc5322({ from: "alice@x.com", messageId: "m3@x.com" }),
        headers: new Map(),
      });
      await adapter.connect();
      await adapter._drainNow();

      expect(received).toHaveLength(1);
      await adapter.disconnect();
    });
  });
});

describe("EmailAdapter — the format the caller declared", () => {
  /**
   * `html` rides ALONGSIDE `text` as a multipart alternative, never instead of it: a
   * plain-text reader shows the text part, so a client that cannot render HTML still gets
   * the message. Sending html-only would make the mail unreadable in exactly the clients
   * this field is supposed to serve.
   */
  it("sends an html part alongside text when the caller declares a format", async () => {
    const { adapter, smtp } = mk();
    await adapter.connect();

    const res = await adapter.sendMessage({
      channel: { id: "someone@example.com", type: "dm" },
      text: "**bold**",
      format: "markdown",
    });

    expect(res.ok).toBe(true);
    expect(smtp.sent[0]?.text).toBe("**bold**");
    expect(smtp.sent[0]?.html).toBeDefined();
  });

  it("sends text only when no format is declared", async () => {
    const { adapter, smtp } = mk();
    await adapter.connect();

    await adapter.sendMessage({
      channel: { id: "someone@example.com", type: "dm" },
      text: "plain",
    });

    expect(smtp.sent[0]?.html).toBeUndefined();
  });

  it("escapes the text it puts in the html part", async () => {
    // The html part is escaped and wrapped, not rendered: a markdown renderer is a dependency
    // this package does not have. Without escaping, a message containing `<script>` would
    // become one in the recipient's client.
    const { adapter, smtp } = mk();
    await adapter.connect();

    await adapter.sendMessage({
      channel: { id: "someone@example.com", type: "dm" },
      text: "<script>alert(1)</script>",
      format: "markdown",
    });

    expect(smtp.sent[0]?.html).not.toContain("<script>");
    expect(smtp.sent[0]?.html).toContain("&lt;script&gt;");
  });
});

describe("EmailAdapter — the html path is a trust boundary", () => {
  it("passes html through unescaped, because the caller declared it as html", async () => {
    // Documented, not accidental. Escaping here would make `format: "html"` meaningless, and
    // sanitising would need an HTML parser in a package with no runtime dependencies. The
    // safe declaration for untrusted text is `markdown`, which escapes — asserted above.
    const { adapter, smtp } = mk();
    await adapter.connect();

    await adapter.sendMessage({
      channel: { id: "someone@example.com", type: "dm" },
      text: "<b>bold</b>",
      format: "html",
    });

    expect(smtp.sent[0]?.html).toBe("<b>bold</b>");
  });
});

describe("EmailAdapter — a server that refuses the html part", () => {
  it("retries with text only, because a plain-text reader would never have seen the difference", async () => {
    const { adapter, smtp } = mk();
    await adapter.connect();
    let attempt = 0;
    const original = smtp.send.bind(smtp);
    smtp.send = async (opts) => {
      attempt += 1;
      if (opts.html !== undefined) throw new Error("html part rejected");
      return await original(opts);
    };
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const res = await adapter.sendMessage({
      channel: { id: "someone@example.com", type: "dm" },
      text: "**bold**",
      format: "markdown",
    });

    expect(res.ok).toBe(true);
    expect(attempt).toBe(2);
    stderr.mockRestore();
  });

  it("does NOT retry a send that had no html part", async () => {
    // Without the guard this would retry every failure once, doubling the latency of an
    // unrelated outage and reporting a formatting problem where there is none.
    const { adapter, smtp } = mk();
    await adapter.connect();
    let attempt = 0;
    smtp.send = async () => {
      attempt += 1;
      throw new Error("smtp down");
    };

    const res = await adapter.sendMessage({
      channel: { id: "someone@example.com", type: "dm" },
      text: "plain",
    });

    expect(res.ok).toBe(false);
    expect(attempt).toBe(1);
  });
});
