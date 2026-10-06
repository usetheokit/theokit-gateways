/**
 * Fetch trims the whitespace around a header value, so `Authorization: Bearer ` with no token
 * arrives as `Bearer`. That carries no credential: it is `missing_authorization`, refused before
 * the body is read or the SDK is called, the same as an empty header.
 */

import { describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, SERVICE_URL } from "./helpers/key-server.js";

describe("an Authorization header with no token", () => {
  it.each([
    ["an empty header", ""],
    ["a Bearer prefix with no token", "Bearer "],
  ])("refuses %s as missing_authorization without calling the SDK", async (_, header) => {
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: module });
    const request = new Request("https://bot.test/api/messages", {
      method: "POST",
      headers: { authorization: header, "content-type": "application/json" },
      body: JSON.stringify({ type: "message", serviceUrl: SERVICE_URL }),
    });

    const res = await verify(request);

    expect(res).toMatchObject({ ok: false, reason: "missing_authorization" });
    expect(calls.check).toBe(0);
  });
});
