/**
 * The SDK validator logs every token it refuses through its default `ConsoleLogger`, including
 * claim values the sender chose (`Token issuer '<iss>' does not match ...`). The verifier hands it
 * a silent logger, so an unauthenticated request cannot write its own text into the host's logs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const CONSOLE_METHODS = ["error", "warn", "info", "debug", "log", "trace"] as const;

describe("a refused token", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await ks?.close();
    ks = undefined;
  });

  it("writes nothing to the console when the installed SDK refuses its issuer", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const spies = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    const res = await verify(
      activityRequest(ks.signToken({ iss: "https://sender-chosen.example/log-line" })),
    );

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual(CONSOLE_METHODS.map(() => 0));
  });
});
