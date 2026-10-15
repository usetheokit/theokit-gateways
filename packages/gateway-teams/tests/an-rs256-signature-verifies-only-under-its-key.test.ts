/**
 * `verifiesRs256` is the signature check the verifier runs before the SDK is asked: true only for a
 * token signed by the given key, and false, never a throw, for anything else.
 */

import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { verifiesRs256 } from "../src/rs256-signature.js";

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

function signedToken(privateKey: KeyObject): string {
  const signingInput = `${encode({ alg: "RS256", kid: "k1" })}.${encode({ aud: "bot" })}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

describe("verifiesRs256", () => {
  let signer: { publicKey: KeyObject; privateKey: KeyObject };
  let other: { publicKey: KeyObject; privateKey: KeyObject };

  beforeAll(() => {
    signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
    other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  });

  it("verifies a token signed by the key", () => {
    expect(verifiesRs256(signedToken(signer.privateKey), signer.publicKey)).toBe(true);
  });

  it("refuses a token signed by another key", () => {
    expect(verifiesRs256(signedToken(other.privateKey), signer.publicKey)).toBe(false);
  });

  it("refuses a token whose payload was changed after signing", () => {
    const [header, , signature] = signedToken(signer.privateKey).split(".");
    const forged = `${header}.${encode({ aud: "another-bot" })}.${signature}`;

    expect(verifiesRs256(forged, signer.publicKey)).toBe(false);
  });

  it("refuses a token with fewer than three parts", () => {
    expect(verifiesRs256("header.payload", signer.publicKey)).toBe(false);
  });

  it("refuses an empty signature", () => {
    const [header, payload] = signedToken(signer.privateKey).split(".");

    expect(verifiesRs256(`${header}.${payload}.`, signer.publicKey)).toBe(false);
  });

  it("answers false instead of throwing for a key that cannot verify RS256", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey;

    expect(verifiesRs256(signedToken(signer.privateKey), ec)).toBe(false);
  });
});
