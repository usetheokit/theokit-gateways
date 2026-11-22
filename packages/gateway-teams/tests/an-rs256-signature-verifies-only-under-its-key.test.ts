/**
 * `verifiesRs256` is the signature check the verifier runs before the SDK is asked: true only for a
 * token signed by the given key, and false, never a throw, for anything else.
 */

import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";

import { verifyRs256Jwt } from "@theokit/gateway";
import { beforeAll, describe, expect, it } from "vitest";

async function verifiesRs256(rawToken: string, publicKey: KeyObject): Promise<boolean> {
  const result = await verifyRs256Jwt(rawToken, { lookup: async () => publicKey });
  return result.ok;
}

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

  it("verifies a token signed by the key", async () => {
    expect(await verifiesRs256(signedToken(signer.privateKey), signer.publicKey)).toBe(true);
  });

  it("refuses a token signed by another key", async () => {
    expect(await verifiesRs256(signedToken(other.privateKey), signer.publicKey)).toBe(false);
  });

  it("refuses a token whose payload was changed after signing", async () => {
    const [header, , signature] = signedToken(signer.privateKey).split(".");
    const forged = `${header}.${encode({ aud: "another-bot" })}.${signature}`;

    expect(await verifiesRs256(forged, signer.publicKey)).toBe(false);
  });

  it("refuses a token with fewer than three parts", async () => {
    expect(await verifiesRs256("header.payload", signer.publicKey)).toBe(false);
  });

  it("refuses an empty signature", async () => {
    const [header, payload] = signedToken(signer.privateKey).split(".");

    expect(await verifiesRs256(`${header}.${payload}.`, signer.publicKey)).toBe(false);
  });

  it("answers false instead of throwing for a key that cannot verify RS256", async () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey;

    expect(await verifiesRs256(signedToken(signer.privateKey), ec)).toBe(false);
  });
});
