/**
 * Finding #25: a request whose body the route (or a framework before it) already read or locked is
 * a fault on the server side, not a malformed activity from the sender. It is refused as
 * `validator_unavailable`, which the README answers with a 503 and a logged message, and the
 * message tells the operator to pass an unread request. A sender's stream that fails while the
 * verifier reads it stays `malformed_body`.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const BODY_ALREADY_READ =
  "the request body was already read or is locked by another reader, so the verifier could not read the activity: this is the route's fault, not the sender's; pass the verifier an unread request, for example request.clone()";

describe("a request body the verifier cannot read", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses a body the route already read as validator_unavailable, before any key or SDK work", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    const req = activityRequest(ks.signToken({}));
    await req.text();

    expect(await verify(req)).toEqual({
      ok: false,
      reason: "validator_unavailable",
      message: BODY_ALREADY_READ,
    });
    expect([calls.ctor.length, calls.check, ks.hits()]).toEqual([0, 0, 0]);
  });

  it("refuses a body another reader holds locked as validator_unavailable", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    const req = activityRequest(ks.signToken({}));
    req.body?.getReader();

    expect(await verify(req)).toEqual({
      ok: false,
      reason: "validator_unavailable",
      message: BODY_ALREADY_READ,
    });
    expect([calls.check, ks.hits()]).toEqual([0, 0]);
  });

  it("refuses a sender's body that fails part-way through the read as malformed_body", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"type":"message","serviceUrl":'));
      },
      pull(controller) {
        controller.error(new Error("connection reset by the sender"));
      },
    });
    const req = new Request("https://bot.test/api/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${ks.signToken({})}`, "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    expect(await verify(req)).toMatchObject({ ok: false, reason: "malformed_body" });
    expect([calls.check, ks.hits()]).toEqual([0, 0]);
  });
});
