/**
 * `WhatsAppAdapter.toDeliverableEvent` / `toDeliverableEvents` (B-421).
 *
 * An app that hosts its own Cloud webhook route hands `deliver()` the events these methods
 * return. They must apply the same sender allowlist and group rule `onInbound` applies, or the
 * route admits every sender the operator refused.
 */

import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
  WhatsAppStatusReceipt,
} from "../src/backend-types.js";
import {
  type MetaWebhookEnvelope,
  parseWebhookPayload,
  WhatsAppAdapter,
  type WhatsAppAdapterCommonOptions,
  WhatsAppCloudBackend,
} from "../src/index.js";

const REFUSAL_PREFIX = "[whatsapp] dropped inbound from a sender";
const CLOUD = { accessToken: "t", phoneNumberId: "PNID", appSecret: "s" } as const;

class FakeBackend implements WhatsAppBackend {
  readonly kind = "cloud" as const;
  inboundHandler?: (e: WhatsAppInboundEvent) => Promise<void>;
  async connect(): Promise<boolean> {
    return true;
  }
  async disconnect(): Promise<void> {}
  async send(_message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    return { ok: true, wamid: "wamid.sent" };
  }
  onInbound(handler: (e: WhatsAppInboundEvent) => Promise<void>): () => void {
    this.inboundHandler = handler;
    return () => {
      this.inboundHandler = undefined;
    };
  }
  onStatusReceipt(_handler: (r: WhatsAppStatusReceipt) => Promise<void>): () => void {
    return () => {};
  }
  async emitInbound(event: WhatsAppInboundEvent): Promise<void> {
    await this.inboundHandler?.(event);
  }
}

/** Every method throws: converting an envelope must never touch the backend. */
class ThrowingBackend implements WhatsAppBackend {
  readonly kind = "cloud" as const;
  connect(): Promise<boolean> {
    throw new Error("backend must not be called");
  }
  disconnect(): Promise<void> {
    throw new Error("backend must not be called");
  }
  send(_message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    throw new Error("backend must not be called");
  }
  onInbound(_handler: (e: WhatsAppInboundEvent) => Promise<void>): () => void {
    throw new Error("backend must not be called");
  }
  onStatusReceipt(_handler: (r: WhatsAppStatusReceipt) => Promise<void>): () => void {
    throw new Error("backend must not be called");
  }
}

interface TextMessage {
  readonly from: string;
  readonly id: string;
  readonly body: string;
}

function envelopeOf(messages: readonly TextMessage[], phoneNumberId = "PNID"): MetaWebhookEnvelope {
  const parsed = parseWebhookPayload(envelopeJson(messages, phoneNumberId));
  if (parsed === null) throw new Error("fixture envelope did not parse");
  return parsed;
}

/** The webhook body Meta posts, before parsing. */
function envelopeJson(messages: readonly TextMessage[], phoneNumberId = "PNID"): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
              contacts: messages.map((m) => ({
                profile: { name: `name ${m.from}` },
                wa_id: m.from,
              })),
              messages: messages.map((m) => ({
                from: m.from,
                id: m.id,
                timestamp: "1700000000",
                type: "text",
                text: { body: m.body },
              })),
            },
          },
        ],
      },
    ],
  };
}

function makeInbound(overrides: Partial<WhatsAppInboundEvent> = {}): WhatsAppInboundEvent {
  return {
    wamid: "wamid.x",
    fromPhone: "5511888888888",
    phoneNumberId: "PNID",
    contactName: "Test User",
    conversationType: "dm",
    channelId: "5511888888888",
    text: "hi",
    receivedAt: 1_700_000_000_000,
    backend: "cloud",
    raw: {},
    ...overrides,
  };
}

let stderrLines: string[] = [];

beforeEach(() => {
  stderrLines = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function refusalLines(): string[] {
  return stderrLines.filter((line) => line.startsWith(REFUSAL_PREFIX));
}

describe("WhatsAppAdapter.toDeliverableEvents", () => {
  it("turns an allowed sender's Cloud message into the event deliver() accepts", async () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD, { allowedSenders: "5511999999999" });
    const received: unknown[] = [];
    adapter.onInbound(async (event) => {
      received.push(event);
    });

    const events = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511999999999", id: "wamid.1", body: "hello" }]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.sender.id).toBe("5511999999999");
    expect(events[0]?.text).toBe("hello");
    const result = await adapter.deliver(events[0] as (typeof events)[number]);
    expect(result).toBe("ok");
    expect(received).toEqual([events[0]]);
    expect(refusalLines()).toEqual([]);
  });

  it("drops a refused sender's message and names the sender once on stderr", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD, { allowedSenders: "5511999999999" });

    const events = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511888888888", id: "wamid.1", body: "let me in" }]),
    );

    expect(events).toEqual([]);
    expect(refusalLines()).toEqual([
      "[whatsapp] dropped inbound from a sender ending in 8888: not in the configured allowlist\n",
    ]);
  });

  it("returns no event for a status-only envelope", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550000000", phone_number_id: "PNID" },
                statuses: [
                  {
                    id: "wamid.sent",
                    status: "delivered",
                    timestamp: "1700000000",
                    recipient_id: "5511999999999",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    if (parsed === null) throw new Error("fixture envelope did not parse");

    const events = adapter.toDeliverableEvents(parsed);

    expect(events).toEqual([]);
  });

  it("keeps envelope order and drops only the refused sender", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD, {
      allowedSenders: "5511999999999,5511777777777",
    });

    const events = adapter.toDeliverableEvents(
      envelopeOf([
        { from: "5511999999999", id: "wamid.1", body: "first" },
        { from: "5511888888888", id: "wamid.2", body: "refused" },
        { from: "5511777777777", id: "wamid.3", body: "third" },
      ]),
    );

    expect(events.map((e) => e.id)).toEqual(["wamid.1", "wamid.3"]);
    expect(refusalLines()).toHaveLength(1);
  });

  it("converts without calling the backend or fetch", () => {
    const fetchStub = vi.fn(() => {
      throw new Error("fetch must not be called");
    });
    vi.stubGlobal("fetch", fetchStub);
    const adapter = new WhatsAppAdapter(new ThrowingBackend(), {
      allowedSenders: "5511999999999",
    });
    const envelope = envelopeOf([
      { from: "5511999999999", id: "wamid.1", body: "allowed" },
      { from: "5511888888888", id: "wamid.2", body: "refused" },
    ]);

    let events: ReturnType<WhatsAppAdapter["toDeliverableEvents"]> = [];
    expect(() => {
      events = adapter.toDeliverableEvents(envelope);
    }).not.toThrow();
    expect(events).toHaveLength(1);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses every sender when the allowlist is configured empty", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD, { allowedSenders: "" });

    const events = adapter.toDeliverableEvents(
      envelopeOf([
        { from: "5511999999999", id: "wamid.1", body: "a" },
        { from: "5511888888888", id: "wamid.2", body: "b" },
      ]),
    );

    expect(events).toEqual([]);
    expect(refusalLines()).toHaveLength(2);
  });

  it("returns no event for an envelope with no entries", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD, { allowedSenders: "5511999999999" });
    const parsed = parseWebhookPayload({ object: "whatsapp_business_account", entry: [] });
    if (parsed === null) throw new Error("fixture envelope did not parse");

    const events = adapter.toDeliverableEvents(parsed);

    expect(events).toEqual([]);
    expect(stderrLines).toEqual([]);
  });

  it("reports no_handler when nothing subscribed", async () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);
    const events = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511999999999", id: "wamid.1", body: "hello" }]),
    );
    expect(events).toHaveLength(1);

    const result = await adapter.deliver(events[0] as (typeof events)[number]);

    expect(result).toBe("no_handler");
  });
});

describe("WhatsAppAdapter.toDeliverableEvents and the envelope's phone number id", () => {
  // Meta signs every number of one app with one app secret, so a valid signature does not say
  // which number an envelope was addressed to. A Cloud adapter answers for its own number only.
  it("drops a message addressed to another phone number id and says so on stderr", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);

    const events = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511999999999", id: "wamid.1", body: "hello" }], "OTHER"),
    );

    expect(events).toEqual([]);
    expect(stderrLines.filter((line) => line.includes('phone number id "OTHER"'))).toHaveLength(1);
  });

  it("drops a foreign-number message on an adapter constructed around a Cloud backend", () => {
    const adapter = new WhatsAppAdapter(new WhatsAppCloudBackend(CLOUD));

    const foreign = adapter.toDeliverableEvent(makeInbound({ phoneNumberId: "OTHER" }));
    const own = adapter.toDeliverableEvent(makeInbound({ phoneNumberId: "PNID" }));

    expect(foreign).toBeUndefined();
    expect(own?.whatsapp.phoneNumberId).toBe("PNID");
    expect(stderrLines.filter((line) => line.includes('phone number id "OTHER"'))).toHaveLength(1);
  });

  it("drops a foreign-number message on an adapter around a backend that is not WhatsAppCloudBackend but declares its number", () => {
    // A wrapper, a test double, or a WhatsAppCloudBackend from the package's other build (ESM vs
    // CJS) is not an instance of this module's class. The number the backend declares decides.
    class NumberDeclaringBackend extends FakeBackend {
      readonly phoneNumberId = "PNID";
    }
    const adapter = new WhatsAppAdapter(new NumberDeclaringBackend());

    const foreign = adapter.toDeliverableEvent(makeInbound({ phoneNumberId: "OTHER" }));
    const own = adapter.toDeliverableEvent(makeInbound({ phoneNumberId: "PNID" }));

    expect(foreign).toBeUndefined();
    expect(own?.whatsapp.phoneNumberId).toBe("PNID");
  });

  it("keeps the envelope's phone number id on the event of an adapter with no Cloud number", () => {
    const adapter = new WhatsAppAdapter(new FakeBackend());

    const events = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511999999999", id: "wamid.1", body: "hello" }], "OTHER"),
    );

    expect(events.map((e) => e.whatsapp.phoneNumberId)).toEqual(["OTHER"]);
  });
});

describe("the foreign phone number id on the single-message and backend-hosted paths", () => {
  // The check sits in toDeliverableEvent so all three paths decide alike; these pin the two paths
  // that do not go through toDeliverableEvents.
  it("toDeliverableEvent on a fromCloud adapter drops a message for another number", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);

    const event = adapter.toDeliverableEvent(makeInbound({ phoneNumberId: "OTHER" }));

    expect(event).toBeUndefined();
    expect(stderrLines.filter((line) => line.includes('phone number id "OTHER"'))).toHaveLength(1);
  });

  it("onInbound on a fromCloud adapter receives the own number's message and not another's", async () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);
    const received: string[] = [];
    adapter.onInbound(async (event) => {
      received.push(event.id);
    });
    const backend = adapter.getBackend() as WhatsAppCloudBackend;
    const post = async (wamid: string, phoneNumberId: string): Promise<boolean> => {
      const body = JSON.stringify(
        envelopeJson([{ from: "5511999999999", id: wamid, body: "hello" }], phoneNumberId),
      );
      const hex = createHmac("sha256", CLOUD.appSecret).update(body).digest("hex");
      return backend.handleWebhookPayload(body, `sha256=${hex}`);
    };

    expect(await post("wamid.foreign", "OTHER")).toBe(true);
    expect(await post("wamid.own", "PNID")).toBe(true);

    expect(received).toEqual(["wamid.own"]);
    expect(stderrLines.filter((line) => line.includes('phone number id "OTHER"'))).toHaveLength(1);
  });
});

describe("the foreign phone number id report", () => {
  const foreignLines = (id: string): string[] =>
    stderrLines.filter((line) => line.includes(`phone number id "${id}"`));

  it("names a foreign number once however many of its messages arrive", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);

    const first = adapter.toDeliverableEvents(
      envelopeOf(
        [
          { from: "5511999999999", id: "wamid.1", body: "one" },
          { from: "5511999999999", id: "wamid.2", body: "two" },
        ],
        "OTHER",
      ),
    );
    const later = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511999999999", id: "wamid.3", body: "three" }], "OTHER"),
    );

    expect([...first, ...later]).toEqual([]);
    expect(foreignLines("OTHER")).toHaveLength(1);
    expect(foreignLines("OTHER")[0]).toContain('this adapter answers for "PNID"');
  });

  it("names each foreign number on its own line", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);

    adapter.toDeliverableEvent(makeInbound({ phoneNumberId: "OTHER" }));
    adapter.toDeliverableEvent(makeInbound({ phoneNumberId: "THIRD" }));

    expect(foreignLines("OTHER")).toHaveLength(1);
    expect(foreignLines("THIRD")).toHaveLength(1);
  });

  it("drops a Cloud message with no phone number id and names it (none), once", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);

    const first = adapter.toDeliverableEvent(makeInbound({ phoneNumberId: undefined }));
    const second = adapter.toDeliverableEvent(
      makeInbound({ wamid: "wamid.y", phoneNumberId: undefined }),
    );

    expect([first, second]).toEqual([undefined, undefined]);
    expect(foreignLines("(none)")).toHaveLength(1);
  });

  it("still delivers the adapter's own number after dropping a foreign one", () => {
    const adapter = WhatsAppAdapter.fromCloud(CLOUD);

    const events = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511999999999", id: "wamid.foreign", body: "x" }], "OTHER"),
    );
    const own = adapter.toDeliverableEvents(
      envelopeOf([{ from: "5511999999999", id: "wamid.own", body: "y" }], "PNID"),
    );

    expect(events).toEqual([]);
    expect(own.map((e) => e.id)).toEqual(["wamid.own"]);
  });
});

describe("WhatsAppAdapter.toDeliverableEvent", () => {
  it("drops a group message that does not mention the bot", () => {
    const adapter = new WhatsAppAdapter(new FakeBackend(), { botPhoneId: "5511777777777" });

    const dropped = adapter.toDeliverableEvent(
      makeInbound({ conversationType: "group", channelId: "group@g.us", text: "hello all" }),
    );
    const addressed = adapter.toDeliverableEvent(
      makeInbound({
        conversationType: "group",
        channelId: "group@g.us",
        text: "@55 11 77777-7777 hi",
      }),
    );

    expect(dropped).toBeUndefined();
    expect(addressed?.text).toBe("@55 11 77777-7777 hi");
  });

  interface ParityRow {
    readonly name: string;
    readonly options: WhatsAppAdapterCommonOptions;
    readonly inbound: WhatsAppInboundEvent;
    /** Refusal lines either path must write: one for a refused sender, none otherwise. */
    readonly refusals: number;
    /** Whether the message reaches the agent: both paths must agree AND be right. */
    readonly kept: boolean;
  }

  const group = { conversationType: "group", channelId: "group@g.us" } as const;
  const parityRows: readonly ParityRow[] = [
    {
      name: "allowed DM",
      options: { allowedSenders: "5511999999999" },
      inbound: makeInbound({ fromPhone: "5511999999999", channelId: "5511999999999" }),
      refusals: 0,
      kept: true,
    },
    {
      name: "refused DM",
      options: { allowedSenders: "5511999999999" },
      inbound: makeInbound({ fromPhone: "5511888888888" }),
      refusals: 1,
      kept: false,
    },
    {
      name: "fromSelf under an allowlist",
      options: { allowedSenders: "553598838687" },
      inbound: makeInbound({ fromPhone: "231116569108705@lid", fromSelf: true, text: "note" }),
      refusals: 0,
      kept: true,
    },
    {
      name: "group not addressed",
      options: { botPhoneId: "5511777777777" },
      inbound: makeInbound({ ...group, text: "hello all" }),
      refusals: 0,
      kept: false,
    },
    {
      name: "group addressed",
      options: { botPhoneId: "5511777777777" },
      inbound: makeInbound({ ...group, text: "+55 (11) 77777-7777 hi" }),
      refusals: 0,
      kept: true,
    },
    {
      name: "group with requireMention false",
      options: { botPhoneId: "5511777777777", requireMention: false },
      inbound: makeInbound({ ...group, text: "hello all" }),
      refusals: 0,
      kept: true,
    },
    {
      name: "group with requireMention on and botPhoneId empty",
      options: { requireMention: true, botPhoneId: "" },
      inbound: makeInbound({ ...group, text: "hello all" }),
      refusals: 0,
      kept: false,
    },
  ];

  async function decideBothWays(row: ParityRow) {
    const backend = new FakeBackend();
    const viaInbound = new WhatsAppAdapter(backend, row.options);
    const seen: unknown[] = [];
    viaInbound.onInbound(async (event) => {
      seen.push(event);
    });
    stderrLines = [];
    await backend.emitInbound(row.inbound);
    const inboundStderr = [...stderrLines];

    stderrLines = [];
    const viaMethod = new WhatsAppAdapter(new FakeBackend(), row.options);
    const decided = viaMethod.toDeliverableEvent(row.inbound);
    const methodStderr = [...stderrLines];
    return { seen, decided, inboundStderr, methodStderr };
  }

  it("covers the seven parity rows", () => {
    expect(parityRows).toHaveLength(7);
  });

  it.each(parityRows.map((row) => [row.name, row] as const))(
    "gives onInbound and toDeliverableEvent the same, correct verdict for %s",
    async (_, row) => {
      const { seen, decided, inboundStderr, methodStderr } = await decideBothWays(row);

      expect(decided !== undefined).toBe(row.kept);
      expect(seen).toEqual(decided === undefined ? [] : [decided]);
      expect(methodStderr).toEqual(inboundStderr);
      expect(methodStderr.filter((line) => line.startsWith(REFUSAL_PREFIX))).toHaveLength(
        row.refusals,
      );
    },
  );
});
