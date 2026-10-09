/**
 * The verifier reads a key set with `redirect: "error"`: a key endpoint that answers with a
 * redirect is a failed read, so it cannot bounce the read to another host, which is the one place
 * the verifier would otherwise fetch keys from a URL it was not configured with (B-420,
 * F-dom-infra-2).
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

/** A server that answers every request with a 302 to `location`. */
async function startRedirector(location: string): Promise<Server> {
  const server = createServer((_req, res) => {
    res.writeHead(302, { location });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

describe("a key-set read that redirects", () => {
  let ks: KeyServer | undefined;
  let redirector: Server | undefined;

  afterEach(async () => {
    await ks?.close();
    await new Promise((resolve) => redirector?.close(resolve) ?? resolve(undefined));
    ks = undefined;
    redirector = undefined;
  });

  it("is key_set_unavailable, and the key set it points at is never read", async () => {
    ks = await startKeyServer();
    redirector = await startRedirector(`http://127.0.0.1:${ks.port}/keys`);
    const origin = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: {
        loginEndpoint: origin,
        tokenIssuer: ks.cloud.tokenIssuer,
        openIdMetadataUrl: `${origin}/openidconfiguration`,
      },
      __validatorModule: module,
    });

    const result = await verify(activityRequest(ks.signToken({})));

    expect(result).toMatchObject({ ok: false, reason: "key_set_unavailable" });
    expect([ks.hits(), calls.check]).toEqual([0, 0]);
  });
});
