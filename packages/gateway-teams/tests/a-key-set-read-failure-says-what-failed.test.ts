/**
 * During a key-set outage the refusals are the only signal an operator has. A firewall blocking
 * egress, a wrong URL answering 404, Microsoft answering 503 and an endpoint that never answers
 * used to give one identical `key_set_unavailable` message. Each now names the key set and what
 * failed, and nothing a sender chose (B-420, review finding #96).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

/** The refusal message for one genuine token at a cold start, after `prepare` breaks the read. */
async function coldStartRefusal(ks: KeyServer, prepare: () => void): Promise<string> {
  const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
  const token = ks.signToken({});
  prepare();
  const res = await verify(activityRequest(token));
  expect(res).toMatchObject({ ok: false, reason: "key_set_unavailable" });
  const message = res.ok ? "" : res.message;
  expect(message).not.toContain(token);
  return message;
}

describe("a key-set read that fails", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await ks?.close();
    ks = undefined;
  });

  it("names the HTTP status and the key set it read", async () => {
    ks = await startKeyServer();
    const server = ks;

    const message = await coldStartRefusal(server, () => server.failNext(503));

    expect(message).toContain("HTTP 503");
    expect(message).toContain(`${server.cloud.loginEndpoint}/keys`);
    expect(message).toContain("Bot Framework");
  });

  it("says the read timed out, distinguishably from a 503", async () => {
    ks = await startKeyServer();
    const server = ks;
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(50));

    const timedOut = await coldStartRefusal(server, () => {
      server.holdNext();
    });

    expect(timedOut).toMatch(/no answer within 10 s/);
    expect(timedOut).not.toContain("HTTP");
  });

  it("says the document listed no keys array", async () => {
    ks = await startKeyServer();
    const server = ks;

    const message = await coldStartRefusal(server, () =>
      server.answerNext({ issuer: "https://api.botframework.com" }),
    );

    expect(message).toMatch(/no keys array/);
  });

  it("names the network error code when the endpoint refuses the connection", async () => {
    ks = await startKeyServer();
    const server = ks;
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: server.cloud });
    const token = server.signToken({});
    await server.close();
    ks = undefined;

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "key_set_unavailable" });
    expect(res.ok ? "" : res.message).toMatch(/request failed \(\w+ ECONNREFUSED\)/);
  });
});
