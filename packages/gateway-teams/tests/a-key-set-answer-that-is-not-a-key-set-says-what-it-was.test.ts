/**
 * The key endpoint, or whatever stands in front of it, can answer with something that is not a key
 * set: a proxy's HTML page, a 204 or a 304 with no body, `null`, a body cut part-way, a document
 * over the size or key-count bound. Each is a failed read, refused as the retryable
 * `key_set_unavailable` with a message naming what came back, and never a throw. A document at
 * exactly a bound is read (B-420, review findings #39 and #96).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const MAX_KEY_SET_BYTES = 1024 * 1024;

/** A JSON key-set document of exactly `bytes` bytes, listing `keys`. */
function documentOfSize(keys: readonly unknown[], bytes: number): string {
  const empty = JSON.stringify({ keys, padding: "" });
  return JSON.stringify({ keys, padding: "x".repeat(bytes - empty.length) });
}

describe("a key-set answer that is not a key set", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await ks?.close();
    ks = undefined;
  });

  /** A genuine token verified at a cold start, after `prepare` sets up the one key-set answer. */
  async function coldStart(prepare: (ks: KeyServer) => void) {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: acceptingValidatorModule().module,
    });
    const token = ks.signToken({});
    prepare(ks);
    return verify(activityRequest(token));
  }

  const unavailable = (why: string | RegExp) => ({
    ok: false,
    reason: "key_set_unavailable",
    message: typeof why === "string" ? expect.stringContaining(why) : expect.stringMatching(why),
  });

  const accepted = {
    ok: true,
    activity: { type: "message", serviceUrl: SERVICE_URL, channelId: "msteams" },
    token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL },
  };

  it("says the document is not JSON when a 200 carries an HTML page", async () => {
    const res = await coldStart((ks) => ks.answerNextRaw(200, "<html>Access denied</html>"));

    expect(res).toEqual(unavailable("/keys: the document is not JSON)"));
  });

  it("says the document is not JSON when a 204 carries no body", async () => {
    const res = await coldStart((ks) => ks.answerNextRaw(204));

    expect(res).toEqual(unavailable("/keys: the document is not JSON)"));
  });

  it("names the status when a 304 carries no body", async () => {
    const res = await coldStart((ks) => ks.answerNextRaw(304));

    expect(res).toEqual(unavailable("/keys: HTTP 304)"));
  });

  it("says there is no keys array when the document is null", async () => {
    const res = await coldStart((ks) => ks.answerNext(null));

    expect(res).toEqual(unavailable("/keys: the document has no keys array)"));
  });

  it("says the request failed when the body is cut part-way", async () => {
    const res = await coldStart((ks) => ks.breakNext());

    expect(res).toEqual(unavailable(/\/keys: the request failed \(\w+( \w+)?\)\)/));
  });

  it.each<[string, unknown, string]>([
    ["nothing at all (null)", null, "(a thrown object)"],
    ["an error with no cause", new RangeError("x"), "(RangeError)"],
  ])(
    "says the request failed, naming its kind, when fetch rejects with %s",
    async (_, thrown, kind) => {
      const res = await coldStart(() => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(thrown);
      });

      expect(res).toEqual(unavailable(`/keys: the request failed ${kind})`));
    },
  );

  it("says the document lists too many keys when it lists 1001", async () => {
    const res = await coldStart((ks) => {
      const [jwk] = ks.publishedJwks();
      ks.answerNext({ keys: Array.from({ length: 1001 }, (_, i) => ({ ...jwk, kid: `k${i}` })) });
    });

    expect(res).toEqual(unavailable("/keys: the document lists more than 1000 keys)"));
  });

  it("reads a document that lists exactly 1000 keys", async () => {
    const res = await coldStart((ks) => {
      const [jwk] = ks.publishedJwks();
      const others = Array.from({ length: 999 }, (_, i) => ({ ...jwk, kid: `k${i}` }));
      ks.answerNext({ keys: [...others, jwk] });
    });

    expect(res).toEqual(accepted);
  });

  it("says the document is too large when it is one byte over 1 MiB", async () => {
    const res = await coldStart((ks) =>
      ks.answerNextRaw(200, documentOfSize(ks.publishedJwks(), MAX_KEY_SET_BYTES + 1)),
    );

    expect(res).toEqual(unavailable("/keys: the document is over 1048576 bytes)"));
  });

  it("reads a document of exactly 1 MiB", async () => {
    const res = await coldStart((ks) =>
      ks.answerNextRaw(200, documentOfSize(ks.publishedJwks(), MAX_KEY_SET_BYTES)),
    );

    expect(res).toEqual(accepted);
  });
});
