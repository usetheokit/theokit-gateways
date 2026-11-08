import { createRumor, createSeal, createWrap } from "nostr-tools/nip59";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { openGiftWrap, openNip04, sealDirectMessage, sealNip04 } from "../src/dm.js";

const alice = generateSecretKey();
const bob = generateSecretKey();
const alicePub = getPublicKey(alice);
const bobPub = getPublicKey(bob);

describe("NIP-17 direct messages", () => {
  it("opens a gift wrap into the rumor's author, text and kind 14", () => {
    const sealed = sealDirectMessage(alice, alicePub, bobPub, "hello bob");
    const opened = openGiftWrap(sealed.toRecipient, bob);

    expect(opened).toMatchObject({
      id: sealed.rumorId,
      pubkey: alicePub,
      kind: 14,
      text: "hello bob",
    });
  });

  it("addresses the sender's own copy to the sender, carrying the same rumor", () => {
    const sealed = sealDirectMessage(alice, alicePub, bobPub, "hello bob");

    expect(openGiftWrap(sealed.toSelf, alice).id).toBe(sealed.rumorId);
    expect(sealed.toSelf.tags).toContainEqual(["p", alicePub]);
    expect(sealed.toRecipient.tags).toContainEqual(["p", bobPub]);
  });

  it("refuses a wrap whose rumor author differs from its seal's (EC-5)", () => {
    const mallory = generateSecretKey();
    const rumor = createRumor({ kind: 14, content: "forged", tags: [["p", bobPub]] }, alice);
    const wrap = createWrap(createSeal(rumor, mallory, bobPub), bobPub);

    expect(() => openGiftWrap(wrap, bob)).toThrow();
  });
});

describe("NIP-04 direct messages", () => {
  it("decrypts a kind 4 event into its author and text", () => {
    const event = sealNip04(alice, bobPub, "legacy hello");
    const opened = openNip04(event, bob);

    expect(opened).toMatchObject({ id: event.id, pubkey: alicePub, kind: 4, text: "legacy hello" });
    expect(event.tags).toContainEqual(["p", bobPub]);
  });
});
