/**
 * Normalising a Baileys envelope into a `WhatsAppInboundEvent`.
 *
 * This is where the protocol's shape meets ours, and the part most likely to be wrong: JIDs
 * carry device suffixes, a group message puts the real sender in a different field than a
 * DM does, and the same event carries back the messages we sent ourselves.
 *
 * Kept pure so it can be tested exhaustively without a socket — which matters more here than
 * usual, because nothing in this repository can exercise the real protocol at all.
 */

import { describe, expect, it } from "vitest";

import { normalizeWhatsAppId } from "../src/allowlist.js";
import { normalizeBaileysMessage } from "../src/backend/baileys/normalize.js";

/** A Baileys `WAMessage`, in the shape the library actually delivers. */
function envelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "3EB0ABC" },
    messageTimestamp: 1_700_000_000,
    pushName: "Ana",
    message: { conversation: "hello" },
    ...overrides,
  };
}

describe("normalizeBaileysMessage", () => {
  it("maps a direct message", () => {
    const event = normalizeBaileysMessage(envelope());

    expect(event).toMatchObject({
      wamid: "3EB0ABC",
      fromPhone: "5511999999999",
      channelId: "5511999999999",
      conversationType: "dm",
      text: "hello",
      contactName: "Ana",
      backend: "baileys",
    });
  });

  it("converts the timestamp to milliseconds", () => {
    // Baileys reports seconds; every other backend in this package reports milliseconds, so
    // the conversion is what keeps one field meaning one thing across three backends.
    expect(normalizeBaileysMessage(envelope())?.receivedAt).toBe(1_700_000_000_000);
  });

  it("strips the device suffix from a JID", () => {
    // `:12` is a device id. Reducing without removing it first yields 551199999999912, which
    // matches no allowlist entry — the sender stops being recognised the moment they pair a
    // second device.
    const event = normalizeBaileysMessage(
      envelope({ key: { remoteJid: "5511999999999:12@s.whatsapp.net", fromMe: false, id: "X" } }),
    );

    expect(event?.fromPhone).toBe("5511999999999");
  });

  it("takes the real sender from participant in a group", () => {
    // In a group the channel is the group and the sender is the participant. Reading
    // remoteJid as the sender would attribute every group message to the group itself,
    // which breaks both the allowlist and any per-sender session key.
    const event = normalizeBaileysMessage(
      envelope({
        key: {
          remoteJid: "120363012345678901@g.us",
          participant: "5511888888888@s.whatsapp.net",
          fromMe: false,
          id: "G1",
        },
      }),
    );

    expect(event).toMatchObject({
      conversationType: "group",
      channelId: "120363012345678901",
      fromPhone: "5511888888888",
    });
  });

  it("reads text out of an extended message", () => {
    const event = normalizeBaileysMessage(
      envelope({ message: { extendedTextMessage: { text: "quoted reply" } } }),
    );

    expect(event?.text).toBe("quoted reply");
  });

  it("drops a message we sent ourselves", () => {
    // Every backend in this package learned this separately. Without it the bot answers its
    // own replies, forever.
    expect(
      normalizeBaileysMessage(
        envelope({ key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "X" } }),
      ),
    ).toBeUndefined();
  });

  describe("a message the account owner typed to themselves", () => {
    /**
     * The note-to-self pattern, which is what the whole gateway family exists for: you write to
     * yourself on whichever surface is at hand and an agent answers there.
     *
     * MEASURED against a real paired account on 2026-08-30. The envelope arrives as live traffic —
     * `upsert type=notify`, with content — and was discarded for one reason only: `fromMe`. But
     * `fromMe` does not mean "we sent it"; it means "this ACCOUNT sent it", and a human typing on
     * their own phone is not the bot answering its own reply. The blanket refusal was broader than
     * the rationale written beside it, and the difference is exactly this use case.
     *
     * The narrow rule needs two facts one envelope cannot carry, so the backend supplies them:
     * which JIDs ARE this account, and which message ids this backend sent.
     */
    const SELF = new Set(["553598838687", "231116569108705"]);

    it("dispatches it when the id is not one we sent, and marks it as the owner's own", () => {
      const event = normalizeBaileysMessage(
        envelope({ key: { remoteJid: "553598838687@s.whatsapp.net", fromMe: true, id: "TYPED" } }),
        { selfJids: SELF },
      );

      // `fromSelf` exists because the sender identity alone cannot carry this. A self-note in the
      // self-chat reports the account's LID as its sender — MEASURED on a real session, where
      // `selfJids` learned `553598838687, 231116569108705` and the note arrived on the LID. An
      // allowlist written with a phone number therefore drops it, and nobody can be expected to
      // look up their own LID. The flag lets the layer that owns the policy answer the question
      // it is actually being asked: is this a stranger, or the owner?
      expect(event).toMatchObject({ wamid: "TYPED", fromPhone: "553598838687", text: "hello" });
      expect(event?.fromSelf).toBe(true);
    });

    it("leaves fromSelf unset on an ordinary inbound", () => {
      // Absent rather than `false`, so a consumer reading the field cannot mistake "someone else
      // wrote this" for "we did not check".
      expect(normalizeBaileysMessage(envelope())?.fromSelf).toBeUndefined();
    });

    it("dispatches it when the self-chat is addressed by LID", () => {
      // The self-chat's remoteJid is the account's own LID, not its phone JID — measured, and the
      // reason `selfJids` is a SET rather than one id.
      const event = normalizeBaileysMessage(
        envelope({ key: { remoteJid: "231116569108705:51@lid", fromMe: true, id: "VIA_LID" } }),
        { selfJids: SELF },
      );

      expect(event).toMatchObject({ wamid: "VIA_LID" });
    });

    it("still refuses the reply this backend itself sent", () => {
      // The hazard the blanket rule existed for, kept — and now aimed at what actually causes it.
      expect(
        normalizeBaileysMessage(
          envelope({ key: { remoteJid: "553598838687@s.whatsapp.net", fromMe: true, id: "OURS" } }),
          { selfJids: SELF, sentWamids: new Set(["OURS"]) },
        ),
      ).toBeUndefined();
    });

    it("refuses a message the owner sent to SOMEBODY ELSE", () => {
      // Answering here would put the agent into a conversation with a third party, on the owner's
      // behalf, triggered by the owner's own words. Only the self-chat is the agent's business.
      expect(
        normalizeBaileysMessage(
          envelope({
            key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "TO_ANA" },
          }),
          { selfJids: SELF },
        ),
      ).toBeUndefined();
    });

    it("refuses everything from this account when the backend does not know its own JIDs", () => {
      // An empty set means "unknown", and the safe reading of not knowing which chat is the
      // self-chat is not "treat every chat as the self-chat".
      expect(
        normalizeBaileysMessage(
          envelope({ key: { remoteJid: "553598838687@s.whatsapp.net", fromMe: true, id: "X" } }),
          { selfJids: new Set() },
        ),
      ).toBeUndefined();
    });
  });

  it("drops the status feed — by the status rule, and again by id normalisation", () => {
    // Over-determined, and stated rather than hidden: an audit found this test passing whether
    // or not the status rule exists, because `normalizeWhatsAppId("status@broadcast")` strips
    // the domain and then every non-digit, leaving "" — which `resolveParties` refuses anyway.
    //
    // No input can isolate the status rule: the only JID it matches is the one that always
    // normalises to empty. So this asserts both facts instead of claiming an isolation it does
    // not have. The rule stays because it fires FIRST and says why the message is refused; the
    // id guard refuses it for an unrelated reason that would stop holding the day
    // `normalizeWhatsAppId` learns to keep non-digits.
    expect(
      normalizeBaileysMessage(
        envelope({ key: { remoteJid: "status@broadcast", fromMe: false, id: "X" } }),
      ),
    ).toBeUndefined();
    expect(normalizeWhatsAppId("status@broadcast")).toBe("");
  });

  it("drops a message carrying no text — v1 is text-only", () => {
    expect(normalizeBaileysMessage(envelope({ message: { imageMessage: {} } }))).toBeUndefined();
    expect(normalizeBaileysMessage(envelope({ message: undefined }))).toBeUndefined();
  });

  it("drops an envelope with no key rather than throwing", () => {
    // Negative case: hostile or malformed input arrives here straight off a socket, and
    // Baileys has shipped a spoofing advisory. Returning undefined is the contract; throwing
    // would take down whatever is dispatching.
    expect(normalizeBaileysMessage(undefined)).toBeUndefined();
    expect(normalizeBaileysMessage({})).toBeUndefined();
    expect(normalizeBaileysMessage({ key: {} })).toBeUndefined();
    expect(normalizeBaileysMessage("not an object")).toBeUndefined();
  });

  it("drops a group message whose participant is missing", () => {
    // Edge case: the channel is known but the sender is not. Attributing it to the group
    // would let an unidentifiable sender through an allowlist keyed on the group.
    expect(
      normalizeBaileysMessage(
        envelope({ key: { remoteJid: "120363012345678901@g.us", fromMe: false, id: "G2" } }),
      ),
    ).toBeUndefined();
  });

  it("drops an empty-but-present text", () => {
    expect(normalizeBaileysMessage(envelope({ message: { conversation: "" } }))).toBeUndefined();
  });
});

describe("normalizeBaileysMessage — envelope shapes a review found", () => {
  it("reads text out of a disappearing-messages wrapper", () => {
    // Baileys nests the real message inside `ephemeralMessage`. Without unwrapping, every
    // text in a chat with disappearing messages on was dropped in silence — indistinguishable
    // from an image, which the "v1 is text-only" rationale was covering for.
    const event = normalizeBaileysMessage(
      envelope({ message: { ephemeralMessage: { message: { conversation: "vanishing" } } } }),
    );

    expect(event?.text).toBe("vanishing");
  });

  it("reads text out of a view-once wrapper", () => {
    const event = normalizeBaileysMessage(
      envelope({
        message: { viewOnceMessageV2: { message: { extendedTextMessage: { text: "once" } } } },
      }),
    );

    expect(event?.text).toBe("once");
  });

  it("stops unwrapping rather than recursing forever on hostile nesting", () => {
    // The input arrives off a socket from a library with a message-spoofing advisory. A
    // deeply self-nested envelope must exhaust the depth limit, not the stack.
    let nested: Record<string, unknown> = { conversation: "deep" };
    for (let i = 0; i < 12; i += 1) nested = { ephemeralMessage: { message: nested } };

    expect(normalizeBaileysMessage(envelope({ message: nested }))).toBeUndefined();
  });

  it("reads a protobuf Long timestamp instead of stamping it now", () => {
    // Baileys' generated types permit a Long. Read as unparseable, a real user's message would
    // be dropped over a field nobody branches on — so the shape is handled rather than refused.
    const asLong = { low: 1_700_000_000, high: 0, unsigned: false, toNumber: () => 1_700_000_000 };
    const event = normalizeBaileysMessage(envelope({ messageTimestamp: asLong }));

    expect(event?.receivedAt).toBe(1_700_000_000_000);
  });

  it("drops a message whose timestamp cannot be read at all", () => {
    // "Unparseable" must not resolve to "fresh". Dropping is the honest answer.
    expect(normalizeBaileysMessage(envelope({ messageTimestamp: {} }))).toBeUndefined();
    expect(normalizeBaileysMessage(envelope({ messageTimestamp: undefined }))).toBeUndefined();
  });
});
