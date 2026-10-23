import { nsecEncode } from "nostr-tools/nip19";
import { generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { NostrKeyError, parseNostrSecretKey } from "../src/keys.js";

const bytesToHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("parseNostrSecretKey", () => {
  const key = generateSecretKey();

  it("decodes an nsec1 key", () => {
    expect(parseNostrSecretKey(nsecEncode(key))).toEqual(key);
  });

  it("accepts 64 lowercase hex characters", () => {
    expect(parseNostrSecretKey(bytesToHex(key))).toEqual(key);
  });

  it("accepts 64 uppercase hex characters (EC-20)", () => {
    expect(parseNostrSecretKey(bytesToHex(key).toUpperCase())).toEqual(key);
  });

  it("rejects 64 zeros, which is no valid secret key (EC-20)", () => {
    expect(() => parseNostrSecretKey("0".repeat(64))).toThrow(NostrKeyError);
  });

  it("rejects anything else without echoing the value", () => {
    const value = "not-a-key-but-a-secret-looking-value";
    let thrown: unknown;
    try {
      parseNostrSecretKey(value);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(NostrKeyError);
    expect((thrown as Error).message).toBe("secretKey must be an nsec1 key or 64 hex characters");
    expect((thrown as Error).message).not.toContain(value);
  });

  it("rejects a malformed nsec1 key without echoing it", () => {
    const value = `${nsecEncode(key).slice(0, -1)}q`;

    expect(() => parseNostrSecretKey(value)).toThrow(NostrKeyError);
    expect(() => parseNostrSecretKey(value)).not.toThrow(value);
  });
});
