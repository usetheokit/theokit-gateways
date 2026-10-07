/**
 * A key-set document that lists no usable RSA key says nothing about which tokens are genuine: it
 * is an empty, truncated or proxied answer from the key endpoint. Read as a success it replaced the
 * last good copy, and for the next 10 seconds every genuine token was refused as a forgery with a
 * non-retryable `invalid_token` (B-420, review finding #39). It is a failed read: the last good
 * copy is kept, and with no copy the refusal is the retryable `key_set_unavailable`, naming why.
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const stray = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

/** A key-set document whose one key is an EC key, which the Teams SDK cannot verify RS256 with. */
function ecOnlyDocument(): { keys: unknown[] } {
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  return { keys: [{ ...ec, kid: "ec" }] };
}

describe("a key-set document with no usable RSA key", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  /** A verifier that has read the key set once, and whose next read is answered with `document`. */
  async function afterGoodReadThenAnswer(document: unknown) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    ks = await startKeyServer();
    const server = ks;
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: server.cloud });
    const first = await verify(activityRequest(server.signToken({})));
    expect(first.ok).toBe(true);
    vi.advanceTimersByTime(10_000);
    server.answerNext(document);
    // A kid the copy lacks waits for a read, so this read is the one answered with `document`.
    const readTrigger = await verify(
      activityRequest(server.signToken({}, { kid: randomUUID(), key: stray })),
    );
    return { server, verify, readTrigger };
  }

  it.each([
    ["an empty keys array", { keys: [] }],
    ["only an EC key", ecOnlyDocument()],
  ])("keeps the last good copy after a read listing %s", async (_, document) => {
    const { server, verify, readTrigger } = await afterGoodReadThenAnswer(document);

    const genuine = await verify(activityRequest(server.signToken({})));

    expect(readTrigger).toMatchObject({
      ok: false,
      reason: "key_set_unavailable",
      message: expect.stringContaining("no usable RSA key"),
    });
    expect(genuine.ok).toBe(true);
  });

  it.each([
    ["only an EC key", ecOnlyDocument()],
    ["an empty keys array", { keys: [] }],
    [
      "only entries whose key material createPublicKey refuses",
      {
        keys: [
          { kty: "RSA", kid: "no-modulus", e: "AQAB" },
          { kty: "oct", kid: "symmetric", k: "AAAA" },
        ],
      },
    ],
  ])("says key_set_unavailable at a cold start when the document lists %s", async (_, document) => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const token = ks.signToken({});
    ks.answerNext(document);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({
      ok: false,
      reason: "key_set_unavailable",
      message: expect.stringContaining("no usable RSA key"),
    });
  });
});
