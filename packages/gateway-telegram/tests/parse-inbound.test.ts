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
  // has already answered 200 by the time `onMessage` runs, so a throw here is an unhandled
  // rejection in the app's request path, not an error anybody sees.
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
   * **What this assertion can and cannot detect, measured rather than assumed.** Changing the
   * shared `buildEvent` does NOT turn it red: both paths call it, so both sides change equally and
   * the equality still holds. That is not a weakness to fix — it is what an equality between two
   * callers of one function means. What it DOES detect is the risk it exists for: replacing the
   * call with a second, inline mapping makes it fail (verified — 4 assertions red). Drift is
   * introduced by writing a second mapping, and that is the mutation that proves this test.
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
