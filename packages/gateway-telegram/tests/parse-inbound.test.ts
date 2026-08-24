/**
 * `parseInbound` — the half of TheoKit's channel seam that lives on this side.
 *
 * TheoKit's `handleChannelWebhook` owns the route and the signature gate, then hands the app a
 * `payload: unknown` and says, in its own docblock, that translating it is the gateway package's
 * job. Until this function existed, nothing in any of the ten adapters could do that: the mapping
 * lived inside `normalizeEvent(ctx: Context)`, soldered to grammy's `Context` and reachable only
 * from the polling loop. An app wiring the seam had to reimplement Telegram's update format by
 * hand — which is what "translates the payload" was supposed to spare it.
 *
 * The function is pure by construction: no transport, no credential, no network. That is what
 * makes it testable here, and it is also what makes it usable from a webhook the adapter never saw.
 */

import { describe, expect, it } from "vitest";

import { buildEvent, parseInbound } from "../src/parse-inbound.js";

/** A real Telegram `Update`, trimmed to the fields the mapping reads. */
const UPDATE = {
  update_id: 900_001,
  message: {
    message_id: 42,
    date: 1_700_000_000,
    text: "hello",
    chat: { id: -100_123, type: "supergroup" },
    from: { id: 777, username: "ada", first_name: "Ada" },
  },
} as const;

describe("parseInbound", () => {
  it("maps a group update onto the canonical event", () => {
    const event = parseInbound(UPDATE);

    expect(event).not.toBeNull();
    expect(event?.platform).toBe("telegram");
    expect(event?.text).toBe("hello");
    expect(event?.channel).toMatchObject({ id: "-100123", type: "group" });
    expect(event?.sender).toMatchObject({ id: "777", username: "ada", displayName: "Ada" });
    expect(event?.telegram).toMatchObject({ chatId: -100_123, messageId: 42 });
    // `receivedAt` is milliseconds; Telegram sends seconds. Off by 1000 is a real bug class.
    expect(event?.receivedAt).toBe(1_700_000_000_000);
  });

  it("reads a private chat as a dm", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, chat: { id: 777, type: "private" } },
    });

    expect(event?.channel.type).toBe("dm");
  });

  it("reads a forum topic as a thread", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, message_thread_id: 5 },
    });

    expect(event?.channel).toMatchObject({ type: "thread", topicId: "5" });
    expect(event?.telegram.threadId).toBe(5);
  });

  it("falls back to the caption when a media message carries no text", () => {
    const { text: _dropped, ...noText } = UPDATE.message;
    const event = parseInbound({ ...UPDATE, message: { ...noText, caption: "a photo" } });

    expect(event?.text).toBe("a photo");
  });

  // NEGATIVE cases — a webhook body is attacker-reachable and Telegram sends update kinds this
  // function does not handle. Every one must return null rather than throw: `handleChannelWebhook`
  // awaits `onMessage` before it builds the 200, so a throw here means it never is: the
  // rejection reaches the route's error boundary and TheoKit answers 500.
  it.each([
    ["null", null],
    ["a string", "not-an-update"],
    ["a number", 7],
    ["an array", []],
    ["an empty object", {}],
    ["an update with no message (edited_message, callback_query, …)", { update_id: 1 }],
    ["a message with no chat", { update_id: 1, message: { message_id: 1, date: 1 } }],
  ])("returns null for %s", (_label, payload) => {
    expect(parseInbound(payload)).toBeNull();
  });
});

describe("the contract the seam depends on", () => {
  it("returns null for update kinds that legitimately carry no message", () => {
    // EC-1 — these are ORDINARY traffic, not malformed bodies. A bot with an inline keyboard
    // receives them constantly, and an app that treats every null as a defect will cry wolf.
    // Asserted explicitly so the docblock's enumeration is testable rather than a promise.
    expect(parseInbound({ update_id: 1, edited_message: { message_id: 2 } })).toBeNull();
    expect(parseInbound({ update_id: 1, callback_query: { id: "cb-1", data: "x" } })).toBeNull();
  });

  it("converts Telegram's seconds to milliseconds exactly", () => {
    // EC-3 — off by 1000 puts the timestamp in 1970. No type catches it and no other assertion
    // notices, because every other field would still be correct.
    const event = parseInbound({ ...UPDATE, message: { ...UPDATE.message, date: 1_700_000_000 } });

    expect(event?.receivedAt).toBe(1_700_000_000_000);
  });

  it("gives a media message with no caption an empty text, not null", () => {
    // EC-4 — a sticker or a location is a real message an app may want to answer. Conflating it
    // with an unhandled update would drop every one of them.
    const { text: _dropped, ...noText } = UPDATE.message;
    const event = parseInbound({ ...UPDATE, message: noText });

    expect(event).not.toBeNull();
    expect(event?.text).toBe("");
  });
});

describe("one mapping, two paths", () => {
  /**
   * EC-2 — the two fixtures are authored INDEPENDENTLY on purpose.
   *
   * Building one from the other, or passing the same object down both paths, makes this equality
   * hold by construction: it would still pass with two divergent mappings, because both would
   * receive identical input.
   *
   * **What this assertion detects, corrected after review measured the earlier claim false.**
   *
   * An earlier version of this comment said the test detects "replacing the call with a second,
   * inline mapping". It does not: an EXACT copy of `buildEvent` inlined into `parseInbound` leaves
   * the suite green. It detects a second mapping only once that mapping has already DIVERGED in a
   * field this assertion compares — and drift begins as an exact duplicate, so the assertion is
   * blind at the moment the risk starts.
   *
   * Changing the shared `buildEvent` also left it green when this file was first written, and the
   * reason given then was wrong too: it was presented as a property of equality testing, when the
   * real cause was `event.id` being asserted nowhere in the package. That is covered now, so
   * changing `buildEvent`'s `id` turns TWO tests red — this one and the canonical-id test below.
   *
   * (A previous version of this note claimed it turns "this test — and only this test — red". That
   * was false the moment the canonical-id test was added, two describes down, in the same commit.
   * A correction written to end a false claim reintroduced one, which is worth leaving visible.)
   *
   * What remains true: this assertion is the only one comparing the two paths field by field, so it
   * is where a divergence in any covered field is caught first.
   */
  it("builds the same event whether the update arrived by webhook or by polling", () => {
    // Path A — a raw webhook body, written out as Telegram sends it.
    const webhookEvent = parseInbound({
      update_id: 555_001,
      message: {
        message_id: 77,
        date: 1_699_999_999,
        text: "same message",
        chat: { id: -100_555, type: "supergroup" },
        from: { id: 42, username: "grace", first_name: "Grace" },
      },
    });

    // Path B — a grammy `Context`, written out as grammy shapes it. Same values, typed by hand.
    const polledEvent = buildEvent(
      { id: -100_555, type: "supergroup" },
      {
        message_id: 77,
        date: 1_699_999_999,
        text: "same message",
      },
      { id: 42, username: "grace", first_name: "Grace" },
      { fake: "context" },
    );

    expect(webhookEvent).not.toBeNull();
    // `raw` is the escape hatch and differs by construction — the caller's own object.
    const { telegram: webhookTelegram, ...webhookRest } = webhookEvent as NonNullable<
      typeof webhookEvent
    >;
    const { telegram: polledTelegram, ...polledRest } = polledEvent;

    expect(webhookRest).toEqual(polledRest);
    expect({ ...webhookTelegram, raw: null }).toEqual({ ...polledTelegram, raw: null });
  });
});

describe("the boundary narrows every field it copies", () => {
  // Review found the type declared by `TelegramMessageEvent` was not enforced: `text: 5` produced
  // an event whose `text` was the number 5. An app calling `event.text.trim()` then got a
  // `TypeError` thrown out of `onMessage`, turning a delivered message into a 500.
  it.each([
    ["text is not a string", { text: 5 }, "text", ""],
    ["text is an object", { text: { a: 1 } }, "text", ""],
    ["caption is not a string", { text: undefined, caption: 7 }, "text", ""],
  ])("drops %s rather than copying it", (_label, patch, field, expected) => {
    const event = parseInbound({ ...UPDATE, message: { ...UPDATE.message, ...patch } });

    expect(event).not.toBeNull();
    expect(event?.[field as "text"]).toBe(expected);
  });

  it("drops a thread id that is not a number", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, message_thread_id: "5" },
    });

    expect(event?.telegram.threadId).toBeUndefined();
    expect(event?.channel.topicId).toBeUndefined();
    expect(event?.channel.type).toBe("group");
  });

  it("drops a sender name that is not a string", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, from: { id: 1, username: { a: 1 }, first_name: 9 } },
    });

    expect(event?.sender.username).toBeUndefined();
    expect(event?.sender.displayName).toBeUndefined();
    expect(event?.sender.id).toBe("1");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a date of %s instead of producing that timestamp", (_label, date) => {
    // Nothing throws on `receivedAt: NaN` — it silently poisons every ordering and retention
    // decision downstream, which is why it is rejected rather than copied.
    expect(parseInbound({ ...UPDATE, message: { ...UPDATE.message, date } })).toBeNull();
  });

  it("rejects a non-numeric chat id", () => {
    // The guard was fully deletable with the whole suite green before this existed.
    expect(
      parseInbound({
        ...UPDATE,
        message: { ...UPDATE.message, chat: { id: "-100123", type: "group" } },
      }),
    ).toBeNull();
  });

  it("rejects a non-string chat type", () => {
    expect(
      parseInbound({ ...UPDATE, message: { ...UPDATE.message, chat: { id: -1, type: 7 } } }),
    ).toBeNull();
  });

  it("rejects a non-numeric message id", () => {
    expect(
      parseInbound({ ...UPDATE, message: { ...UPDATE.message, message_id: "42" } }),
    ).toBeNull();
  });
});

describe("fields nothing else asserted", () => {
  it("builds the canonical id from the chat and message ids", () => {
    // Review found `event.id` was asserted by no test in this package — so the mutation that
    // changed its prefix survived the entire suite.
    expect(parseInbound(UPDATE)?.id).toBe("tg--100123-42");
  });

  it("carries the caller's own payload through as the raw escape hatch", () => {
    const payload = { ...UPDATE };

    expect(parseInbound(payload)?.telegram.raw).toBe(payload);
  });

  it("maps a reply to the message it answers", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, reply_to_message: { message_id: 41 } },
    });

    expect(event?.replyTo).toBe("41");
  });

  it("omits replyTo when the reply id is not a number", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, reply_to_message: { message_id: "41" } },
    });

    expect(event?.replyTo).toBeUndefined();
  });
});

describe("numeric narrows reject the values that survive a typeof check", () => {
  // Review found four `Number.isFinite` guards droppable with the whole suite green. A `typeof`
  // check admits NaN and Infinity, and neither throws downstream — they poison silently.
  it.each([
    ["message_id", { message_id: Number.NaN }],
    ["chat.id", { chat: { id: Number.NaN, type: "supergroup" } }],
  ])("rejects a non-finite %s", (_label, patch) => {
    expect(parseInbound({ ...UPDATE, message: { ...UPDATE.message, ...patch } })).toBeNull();
  });

  it("rejects a date whose conversion to milliseconds overflows", () => {
    // `1e308` is finite; `1e308 * 1000` is not. The guard has to check the result, not the input.
    expect(parseInbound({ ...UPDATE, message: { ...UPDATE.message, date: 1e308 } })).toBeNull();
  });

  it("drops a non-finite thread id rather than making it a topic", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, message_thread_id: Number.POSITIVE_INFINITY },
    });

    expect(event?.telegram.threadId).toBeUndefined();
    expect(event?.channel.type).toBe("group");
  });

  it("drops a sender whose id is not finite", () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, from: { id: Number.NaN, username: "ada" } },
    });

    expect(event?.sender.id).toBe("anonymous");
    expect(event?.sender.username).toBeUndefined();
  });

  it('drops a reply id that is not finite instead of threading against "NaN"', () => {
    const event = parseInbound({
      ...UPDATE,
      message: { ...UPDATE.message, reply_to_message: { message_id: Number.NaN } },
    });

    expect(event?.replyTo).toBeUndefined();
  });

  it("rejects a payload that is an array, not merely a non-object", () => {
    expect(parseInbound([])).toBeNull();
    expect(parseInbound({ ...UPDATE, message: [] })).toBeNull();
  });
});
