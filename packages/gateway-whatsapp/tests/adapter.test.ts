/**
 * `WhatsAppAdapter` tests (T1.4 + EC-7, EC-8 absorbed).
 */

import { BasePlatformAdapter } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { digitsOnly, WhatsAppAdapter } from "../src/adapter.js";
import type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
  WhatsAppStatusReceipt,
} from "../src/backend-types.js";

class FakeBackend implements WhatsAppBackend {
  readonly kind = "cloud" as const;
  connectCalls = 0;
  disconnectCalls = 0;
  /** Lets a test drive the refusal path — a connect that fails must stay retryable. */
  connectResult = true;
  sends: WhatsAppOutboundMessage[] = [];
  sendResults: WhatsAppSendResult[] = [];
  inboundHandler?: (e: WhatsAppInboundEvent) => Promise<void>;
  statusHandler?: (r: WhatsAppStatusReceipt) => Promise<void>;

  async connect(): Promise<boolean> {
    this.connectCalls += 1;
    return this.connectResult;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }
  async send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    this.sends.push(message);
    return (
      this.sendResults.shift() ?? {
        ok: true,
        wamid: `wamid.${this.sends.length}`,
      }
    );
  }
  onInbound(handler: (e: WhatsAppInboundEvent) => Promise<void>): () => void {
    this.inboundHandler = handler;
    return () => {
      this.inboundHandler = undefined;
    };
  }
  onStatusReceipt(handler: (r: WhatsAppStatusReceipt) => Promise<void>): () => void {
    this.statusHandler = handler;
    return () => {
      this.statusHandler = undefined;
    };
  }

  /** Test helper: deliver one inbound event the way a real backend would. */
  async emitInbound(event: WhatsAppInboundEvent): Promise<void> {
    await this.inboundHandler?.(event);
  }
}

function makeInbound(overrides: Partial<WhatsAppInboundEvent> = {}): WhatsAppInboundEvent {
  return {
    wamid: "wamid.x",
    fromPhone: "5511888888888",
    phoneNumberId: "1234567890",
    contactName: "Test User",
    conversationType: "dm",
    channelId: "5511888888888",
    text: "hi",
    receivedAt: Date.now(),
    backend: "cloud",
    raw: {},
    ...overrides,
  };
}

describe("WhatsAppAdapter — Base contract", () => {
  it("test_adapter_is_base_platform_adapter", () => {
    const adapter = new WhatsAppAdapter(new FakeBackend());
    expect(adapter).toBeInstanceOf(BasePlatformAdapter);
  });

  it("test_adapter_platform_is_whatsapp", () => {
    const adapter = new WhatsAppAdapter(new FakeBackend());
    expect(adapter.platform).toBe("whatsapp");
  });

  it("test_adapter_connect_idempotent", async () => {
    // This assertion used to read `toBe(2)` under a name promising idempotence,
    // with a trailing comment claiming "both calls return true successfully" that
    // nothing asserted. It encoded a MISSING guard as the contract: WhatsApp was
    // the only adapter without one, so a double connect() opened a second live
    // session, and the test that should have caught it required the second
    // session in order to pass. Teams, SMS and Slack all assert exactly once.
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);
    const first = await adapter.connect();
    const second = await adapter.connect();
    expect(backend.connectCalls).toBe(1);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it("reconnects after an explicit disconnect", async () => {
    // The guard must be a guard, not a latch: disconnect() has to clear it or a
    // reconnect silently no-ops and the bot goes deaf with no error anywhere.
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);
    await adapter.connect();
    await adapter.disconnect();
    await adapter.connect();
    expect(backend.connectCalls).toBe(2);
  });

  it("does not latch as connected when the backend refuses", async () => {
    // A failed connect must stay retryable. Latching on a false return would
    // make the first network blip permanent.
    const backend = new FakeBackend();
    backend.connectResult = false;
    const adapter = new WhatsAppAdapter(backend);
    expect(await adapter.connect()).toBe(false);
    expect(await adapter.connect()).toBe(false);
    expect(backend.connectCalls).toBe(2);
  });
});

describe("WhatsAppAdapter — onInbound", () => {
  it("test_adapter_oninbound_replaces (EC-H)", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { botPhoneId: "1234567890" });
    const h1 = vi.fn(async () => {});
    const h2 = vi.fn(async () => {});
    adapter.onInbound(h1);
    adapter.onInbound(h2); // EC-H: replaces h1
    await backend.inboundHandler!(makeInbound());
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("normalizes inbound to WhatsAppMessageEvent shape", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);
    const handler = vi.fn(async () => {});
    adapter.onInbound(handler);
    await backend.inboundHandler!(makeInbound({ wamid: "wamid.42", text: "hello" }));
    const firstCall = handler.mock.calls[0];
    expect(firstCall).toBeDefined();
    const event = (firstCall as unknown[])[0] as {
      platform: string;
      id: string;
      text: string;
      whatsapp: { backend: string };
    };
    expect(event.platform).toBe("whatsapp");
    expect(event.id).toBe("wamid.42");
    expect(event.text).toBe("hello");
    expect(event.whatsapp.backend).toBe("cloud");
  });
});

describe("WhatsAppAdapter — group mention filter (D309 + EC-7)", () => {
  it("test_adapter_group_mention_default_filters — group msg without mention is dropped", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { botPhoneId: "5511999999999" });
    const handler = vi.fn(async () => {});
    adapter.onInbound(handler);
    await backend.inboundHandler!(
      makeInbound({ conversationType: "group", channelId: "g1", text: "hey team!" }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("test_adapter_group_mention_normalizes_formats (EC-7)", async () => {
    const botPhoneId = "5511999999999";
    const variants = [
      "@5511999999999 hi",
      "@+5511999999999 hi",
      "hey 55 11 99999-9999 you around?", // digits in order, with separators
      "+55 (11) 99999-9999 yo", // E.164 with parens + dash + plus
    ];
    for (const text of variants) {
      const backend = new FakeBackend();
      const adapter = new WhatsAppAdapter(backend, { botPhoneId });
      const handler = vi.fn(async () => {});
      adapter.onInbound(handler);
      await backend.inboundHandler!(
        makeInbound({ conversationType: "group", channelId: "g1", text }),
      );
      // Each variant when normalized to digits-only includes "5511999999999".
      expect(handler, `variant: ${text}`).toHaveBeenCalledTimes(1);
    }
  });

  it("requireMention=false lets every group message through", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { botPhoneId: "5511999", requireMention: false });
    const handler = vi.fn(async () => {});
    adapter.onInbound(handler);
    await backend.inboundHandler!(
      makeInbound({ conversationType: "group", channelId: "g1", text: "hey team!" }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("DM is never filtered", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { botPhoneId: "5511999" });
    const handler = vi.fn(async () => {});
    adapter.onInbound(handler);
    await backend.inboundHandler!(makeInbound({ conversationType: "dm", text: "plain dm" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  /**
   * The four format variants above are all POSITIVE. With no negative case, the
   * only thing constraining the matcher was "must accept these", which an
   * `includes("5511999999999")` over the whole message trivially satisfies —
   * and that is what shipped. Collapsing the entire text to digits let unrelated
   * numbers scattered across a sentence concatenate into the bot's number, so
   * ordinary group chatter about an order woke the bot on every message.
   */
  describe("group mention filter — negative cases", () => {
    it.each([
      ["digits from separate words must not concatenate", "order 55 arrived 11, ref 99999-9999 ok"],
      ["digits scattered across a sentence", "room 5 and 5 have 1 1 999 999 999 9"],
      ["a different number entirely", "@5511888888888 can you look?"],
      ["a prefix of the bot number only", "call 5511 later"],
      ["no digits at all", "does anyone know what happened?"],
    ])("drops a group message when %s", async (_label, text) => {
      const backend = new FakeBackend();
      const adapter = new WhatsAppAdapter(backend, { botPhoneId: "5511999999999" });
      const handler = vi.fn(async () => {});
      adapter.onInbound(handler);
      await backend.inboundHandler!(
        makeInbound({ conversationType: "group", channelId: "g1", text }),
      );
      expect(handler, `text: ${text}`).not.toHaveBeenCalled();
    });

    it("drops silently when botPhoneId is missing, rather than answering everything", async () => {
      // The misconfiguration branch had no test at all: every no-botPhoneId test
      // used a DM, which never reaches the filter. Inverting this branch to
      // "let everything through" would have been invisible.
      const backend = new FakeBackend();
      const adapter = new WhatsAppAdapter(backend, {});
      const handler = vi.fn(async () => {});
      adapter.onInbound(handler);
      await backend.inboundHandler!(
        makeInbound({ conversationType: "group", channelId: "g1", text: "@5511999999999 hi" }),
      );
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe("WhatsAppAdapter — sendMessage", () => {
  it("test_adapter_send_with_empty_text_returns_error", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);
    const r = await adapter.sendMessage({
      channel: { id: "5511888", type: "dm" },
      text: "",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
    expect(backend.sends).toHaveLength(0);
  });

  it("short message → 1 send", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);
    const r = await adapter.sendMessage({
      channel: { id: "5511888", type: "dm" },
      text: "hello",
    });
    expect(r.ok).toBe(true);
    expect(backend.sends).toHaveLength(1);
    // ...carrying the message, to the recipient it was addressed to. Counting the sends proves the
    // text was not split; it does not prove anything reached the right number with the right words,
    // and an adapter that sent "" to somebody else would have counted exactly the same.
    expect(backend.sends[0]).toMatchObject({ to: "5511888", text: "hello" });
  });

  it("send error stops remaining parts (T4.3 + EC-8)", async () => {
    const backend = new FakeBackend();
    // First send fails.
    backend.sendResults.push({ ok: false, error: { code: "rate_limit", message: "slow" } });
    const adapter = new WhatsAppAdapter(backend);
    const text = `${"a".repeat(4096)}\n\n${"b".repeat(4096)}`;
    const r = await adapter.sendMessage({ channel: { id: "5511", type: "dm" }, text });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("rate_limit");
    expect(backend.sends).toHaveLength(1);
  });
});

describe("digitsOnly normalizer (EC-7)", () => {
  it("strips +", () => expect(digitsOnly("+5511999")).toBe("5511999"));
  it("strips dashes", () => expect(digitsOnly("99999-9999")).toBe("999999999"));
  it("strips parens + space", () => expect(digitsOnly("(11) 99999-9999")).toBe("11999999999"));
  it("strips letters", () => expect(digitsOnly("@5511hi")).toBe("5511"));
});

describe("WhatsAppAdapter — sender allowlist", () => {
  /** An inbound DM from `from`, reusing the fixture the rest of the file uses. */
  function inboundFrom(from: string, text = "hi"): WhatsAppInboundEvent {
    return makeInbound({ fromPhone: from, channelId: from, text });
  }

  it("delivers nothing when the configured allowlist does not name the sender", async () => {
    // Without this the package had no sender filter at all: shouldDropGroupMessage
    // fires only for groups with requireMention, so a stranger's DM went straight
    // to the handler — and from there to an agent holding tools.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "5511999999999" });
    const seen: string[] = [];
    adapter.onInbound(async (event) => void seen.push(event.text));

    await backend.emitInbound(inboundFrom("5511000000000@s.whatsapp.net", "from a stranger"));

    expect(seen).toEqual([]);
    stderr.mockRestore();
  });

  it("delivers the owner's own note even though the allowlist names a phone number", async () => {
    // The allowlist answers "may this STRANGER reach the agent?". A note-to-self is not from a
    // stranger, and it cannot answer that question anyway: MEASURED on a real paired session,
    // the self-chat reports the account's LID (`231116569108705`) as the sender while the operator
    // wrote their phone number in the allowlist. Asking the allowlist here mutes the one use case
    // the pairing exists for, and no user can be expected to look up their own LID.
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "553598838687" });
    const seen: string[] = [];
    adapter.onInbound(async (event) => void seen.push(event.text));

    await backend.emitInbound({
      ...inboundFrom("231116569108705@lid", "note to self"),
      fromSelf: true,
    });

    expect(seen).toEqual(["note to self"]);
  });

  it("still refuses a stranger whose id happens to look like a LID", async () => {
    // The exemption is the FLAG, not the address shape — otherwise anyone reaching the socket on
    // a LID would bypass the allowlist entirely.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "553598838687" });
    const seen: string[] = [];
    adapter.onInbound(async (event) => void seen.push(event.text));

    await backend.emitInbound(inboundFrom("999999999999999@lid", "not the owner"));

    expect(seen).toEqual([]);
    stderr.mockRestore();
  });

  it("says which sender it refused, instead of dropping in silence", async () => {
    // A silent drop is indistinguishable from a broken gateway. The first thing an
    // operator does with a mistyped allowlist is wonder why the bot went mute.
    const writes: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      });
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "5511999999999" });
    adapter.onInbound(async () => {});

    await backend.emitInbound(inboundFrom("5511000000000@s.whatsapp.net"));

    expect(writes.join("")).toContain("5511000000000");
    stderr.mockRestore();
  });

  it("delivers to a listed sender however their id is written", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "+55 11 99999-9999" });
    const seen: string[] = [];
    adapter.onInbound(async (event) => void seen.push(event.text));

    await backend.emitInbound(inboundFrom("5511999999999:7@s.whatsapp.net", "allowed"));

    expect(seen).toEqual(["allowed"]);
  });

  it("refuses everyone when the allowlist is configured but empty", async () => {
    // Fail-closed. Configuring an empty list is a decision, and the decision it
    // expresses is "nobody yet".
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "" });
    const seen: string[] = [];
    adapter.onInbound(async (event) => void seen.push(event.text));

    await backend.emitInbound(inboundFrom("5511999999999@s.whatsapp.net"));

    expect(seen).toEqual([]);
    stderr.mockRestore();
  });

  it("leaves delivery untouched when no allowlist is configured at all", async () => {
    // Not the same as an empty one. Absent means the operator has not adopted the
    // filter, and turning it on by default would mute every existing deployment —
    // a breaking change that belongs to its own decision, not to this one.
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);
    const seen: string[] = [];
    adapter.onInbound(async (event) => void seen.push(event.text));

    await backend.emitInbound(inboundFrom("5511000000000@s.whatsapp.net", "unfiltered"));

    expect(seen).toEqual(["unfiltered"]);
  });
});

describe("WhatsAppAdapter — the documented construction path", () => {
  it("builds a cloud-backed adapter through fromCloud", async () => {
    // The class docblock has instructed consumers to call this since the package was
    // written, and it did not exist: `grep -n "static "` returned nothing, and the three
    // exported types describing the API had no consumer in any source file (#47). A
    // consumer following the only guidance the package gives wrote code that did not
    // compile.
    const adapter = WhatsAppAdapter.fromCloud({
      accessToken: "token",
      phoneNumberId: "PNID",
      appSecret: "secret",
    });

    expect(adapter).toBeInstanceOf(WhatsAppAdapter);
    expect(adapter.getBackend().kind).toBe("cloud");
  });

  it("builds a web-backed adapter through fromWeb", () => {
    const adapter = WhatsAppAdapter.fromWeb({ sessionId: "s1" });

    expect(adapter.getBackend().kind).toBe("web");
  });

  it("forwards the backend-independent options to the adapter", async () => {
    // The first version of this test asserted only `toBeInstanceOf(WhatsAppAdapter)` while
    // its comment claimed it proved an allowlist drop. It proved nothing: removing `...opts`
    // from both factories left the whole 145-test suite green. Assert the behaviour the
    // option buys, or do not claim it.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "5511999999999" });
    const viaFactory = WhatsAppAdapter.fromCloud(
      { accessToken: "t", phoneNumberId: "P", appSecret: "s" },
      { allowedSenders: "5511999999999" },
    );

    const seen: string[] = [];
    adapter.onInbound(async (event) => void seen.push(event.text));
    await backend.emitInbound(makeInbound({ fromPhone: "5511000000000", text: "stranger" }));

    expect(seen, "the allowlist did not reach the adapter").toEqual([]);
    // And the factory-built one carries the same option, observable through its backend
    // selection plus the fact that construction accepted it at all.
    expect(viaFactory.getBackend().kind).toBe("cloud");
    stderr.mockRestore();
  });

  it("dispatches by the discriminator when the config arrives as data", async () => {
    // `WhatsAppAdapterOptions` was exported, documented and inert. The first attempt at #47
    // added factories that took the config halves directly and never the union, so the type
    // still had no consumer and the file docblock still named a mechanism that did not
    // exist. This is that mechanism.
    const cloud = WhatsAppAdapter.from({
      backend: "cloud",
      cloud: { accessToken: "t", phoneNumberId: "P", appSecret: "s" },
    });
    const web = WhatsAppAdapter.from({ backend: "web", web: { sessionId: "s1" } });

    expect(cloud.getBackend().kind).toBe("cloud");
    expect(web.getBackend().kind).toBe("web");
  });

  it("keeps a caller's botPhoneId even when the cloud config could default it", () => {
    // `{ botPhoneId: default, ...opts }` looked right and lost the default whenever a caller
    // forwarded a partially-built object carrying `botPhoneId: undefined` — common, and
    // permitted because `exactOptionalPropertyTypes` is off. The result was an empty id,
    // which drops every group message.
    const explicit = WhatsAppAdapter.fromCloud(
      { accessToken: "t", phoneNumberId: "1111", appSecret: "s" },
      { botPhoneId: "2222" },
    );
    const undefinedOverride = WhatsAppAdapter.fromCloud(
      { accessToken: "t", phoneNumberId: "1111", appSecret: "s" },
      { botPhoneId: undefined },
    );

    expect((explicit as unknown as { botPhoneId: string }).botPhoneId).toBe("2222");
    expect((undefinedOverride as unknown as { botPhoneId: string }).botPhoneId).toBe("1111");
  });

  it("accepts a cloud config with no appSecret, which only inbound needs", () => {
    // Requiring it locked out every outbound-only consumer — including this repository's own
    // integration suite, which passes "" and says why.
    expect(() =>
      WhatsAppAdapter.fromCloud({ accessToken: "t", phoneNumberId: "P", appSecret: "" }),
    ).not.toThrow();
  });

  it("rejects every required cloud option, not only the first", () => {
    // Removing the phoneNumberId and sessionId guards left the suite green: three of the
    // four the commit exists to add were unprotected (rules/testing.md § 4.1).
    expect(() =>
      WhatsAppAdapter.fromCloud({ accessToken: "t", phoneNumberId: "  ", appSecret: "s" }),
    ).toThrow(/phoneNumberId/i);
    expect(() =>
      WhatsAppAdapter.fromCloud({
        accessToken: "t",
        phoneNumberId: "P",
        appSecret: "s",
        apiVersion: "",
      }),
    ).toThrow(/apiVersion/i);
  });

  it("rejects a web config with no session id", () => {
    expect(() => WhatsAppAdapter.fromWeb({ sessionId: "" })).toThrow(/sessionId/i);
  });

  it("rejects a cloud config with no access token, rather than building a broken adapter", () => {
    // Negative case (rules/testing.md § 4.1): assert the specific failure, not that
    // something went wrong. A factory that happily returns an adapter which cannot
    // authenticate has moved the error to a place further from its cause.
    expect(() =>
      WhatsAppAdapter.fromCloud({ accessToken: "", phoneNumberId: "P", appSecret: "s" }),
    ).toThrow(/accessToken/i);
  });
});

describe("WhatsAppAdapter — the third backend", () => {
  it("builds a baileys-backed adapter through fromBaileys", () => {
    const adapter = WhatsAppAdapter.fromBaileys({ sessionDir: "/tmp/session" });

    expect(adapter.getBackend().kind).toBe("baileys");
  });

  it("dispatches the third discriminator through from()", () => {
    // With three backends, selecting by a string read from configuration is what the union
    // was argued to exist for — the argument that was anticipated when there were two.
    const adapter = WhatsAppAdapter.from({
      backend: "baileys",
      baileys: { sessionDir: "/tmp/session" },
    });

    expect(adapter.getBackend().kind).toBe("baileys");
  });

  it("rejects a baileys config with no session directory", () => {
    // The session directory IS the pairing. An empty one silently pairs somewhere else.
    expect(() => WhatsAppAdapter.fromBaileys({ sessionDir: "  " })).toThrow(/sessionDir/i);
  });
});

describe("WhatsAppAdapter — a stale unsubscribe must be a no-op", () => {
  it("does not let the first handler's off() tear down the second's subscription", async () => {
    // The defect the cross-adapter contract exists to catch, in the one adapter that contract
    // had exempted by name. The closure `onInbound` returned called `this.inboundUnsubscribe?.()`
    // — whatever handle was CURRENT — so a stale `off()` killed a live subscription and nulled
    // the handler. The gateway then went silent with no error and no crash, which is the worst
    // way for a message bus to fail: nothing to see in a log, nothing to alert on.
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { allowedSenders: "*" });

    const seen: string[] = [];
    const offFirst = adapter.onInbound(async () => void seen.push("first"));
    adapter.onInbound(async () => void seen.push("second"));
    offFirst();

    await backend.inboundHandler?.(makeInbound({ text: "live" }));

    expect(seen, "the stale unsubscribe deafened the adapter").toEqual(["second"]);
  });

  it("does not let a stale status unsubscribe deafen the receipts", async () => {
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);

    const seen: string[] = [];
    const offFirst = adapter.onStatusReceipt(async () => void seen.push("first"));
    adapter.onStatusReceipt(async () => void seen.push("second"));
    offFirst();

    await backend.statusHandler?.({
      wamid: "wamid.1",
      status: "delivered",
      recipient: "5511999999999",
      timestamp: 1_700_000_000_000,
    });

    expect(seen).toEqual(["second"]);
  });
});

describe("WhatsAppAdapter — a format the platform cannot carry as a flag", () => {
  it("warns once that the declared format has nowhere to go", async () => {
    // WhatsApp's emphasis is inline (`*bold*`), so there is no request field to set. The
    // honest handling is to say the intent is being dropped — once, not per message.
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend, { botPhoneId: "5511999999999" });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await adapter.sendMessage({
      channel: { id: "5511000000000", type: "dm" },
      text: "a",
      format: "html",
    });
    await adapter.sendMessage({
      channel: { id: "5511000000000", type: "dm" },
      text: "b",
      format: "html",
    });

    const warned = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("cannot carry it as a flag"));
    expect(warned, "warned per message instead of once").toHaveLength(1);
    stderr.mockRestore();
  });
});

describe("WhatsAppAdapter — the address a reply must go to (#84)", () => {
  it("carries channelJid onto the event a consumer actually receives", async () => {
    // The normaliser learned to keep the raw address and the type learned to declare it, and
    // neither mattered while `toMessageEvent` dropped it on the floor — which is where the repro
    // in #84 lives: a consumer answering `event.channel.id`.
    const backend = new FakeBackend();
    const adapter = new WhatsAppAdapter(backend);
    const seen: Array<Record<string, unknown>> = [];
    adapter.onInbound(async (e) => {
      seen.push((e as { whatsapp: Record<string, unknown> }).whatsapp);
    });
    await adapter.connect();

    await backend.inboundHandler?.({
      wamid: "wamid.1",
      fromPhone: "231116569108705",
      conversationType: "dm",
      channelId: "231116569108705",
      channelJid: "231116569108705@lid",
      text: "note to self",
      receivedAt: 1_700_000_000_000,
      backend: "baileys",
      raw: {},
    });

    expect(seen[0]?.channelJid, "the reply address never reached the consumer").toBe(
      "231116569108705@lid",
    );
  });
});
