/**
 * The body is read before the token is verified, because the `serviceurl` check needs the
 * activity. So the read is bounded: a body over 1 MiB is refused as `malformed_body` without being
 * parsed or handed to the SDK, whether or not it declares its length.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const OVERSIZED = JSON.stringify({
  type: "message",
  serviceUrl: SERVICE_URL,
  text: "x".repeat(1024 * 1024),
});

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunk = 64 * 1024;
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}

describe("an oversized body", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it.each([
    ["a string body", () => OVERSIZED],
    ["a streamed body with no declared length", () => streamOf(OVERSIZED)],
  ])("refuses %s over 1 MiB as malformed_body without calling the SDK", async (_, body) => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: module });
    const request = new Request("https://bot.test/api/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${ks.signToken({})}`, "content-type": "application/json" },
      body: body(),
      duplex: "half",
    } as RequestInit);

    const res = await verify(request);

    expect(res).toMatchObject({ ok: false, reason: "malformed_body" });
    expect(calls.check).toBe(0);
  });
});
