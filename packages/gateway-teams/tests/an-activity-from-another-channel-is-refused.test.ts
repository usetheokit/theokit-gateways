/**
 * A verified token says Microsoft's connector sent the request; it does not say the request came
 * from Teams. One bot's other channels (Web Chat, Direct Line, enabled by default on an Azure Bot
 * resource) get connector tokens with the same audience, and on those channels the client, not
 * Microsoft, sets `from` and `channelData`. So an activity whose `channelId` is absent or is not
 * `msteams` is `channel_mismatch`, even when every token check passes (B-420, review findings #94
 * and #98).
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const DIRECT_LINE = "https://directline.botframework.com/";

describe("an activity from another channel", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses a Direct Line activity whose genuine token matches its serviceUrl as channel_mismatch", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const activity = { type: "message", serviceUrl: DIRECT_LINE, channelId: "directline" };

    const res = await verify(activityRequest(ks.signToken({ serviceurl: DIRECT_LINE }), activity));

    expect(res).toMatchObject({ ok: false, reason: "channel_mismatch" });
    expect(res.ok ? "" : res.message).toContain("msteams");
  });

  it("refuses a Web Chat activity as channel_mismatch", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const activity = { type: "message", serviceUrl: SERVICE_URL, channelId: "webchat" };

    const res = await verify(activityRequest(ks.signToken({}), activity));

    expect(res).toMatchObject({ ok: false, reason: "channel_mismatch" });
  });

  it("refuses an activity that names no channel as channel_mismatch", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const activity = { type: "message", serviceUrl: SERVICE_URL };

    const res = await verify(activityRequest(ks.signToken({}), activity));

    expect(res).toMatchObject({ ok: false, reason: "channel_mismatch" });
  });

  it("accepts the same genuine token on an msteams activity", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const activity = { type: "message", serviceUrl: SERVICE_URL, channelId: "msteams" };

    const res = await verify(activityRequest(ks.signToken({}), activity));

    expect(res).toEqual({
      ok: true,
      activity,
      token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL },
    });
  });
});
