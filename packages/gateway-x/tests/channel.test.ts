import * as gateway from "@theokit/gateway";
import * as vitest from "vitest";

import { describeChannelContract } from "../../../test-support/channel-contract.js";
import { XAdapter } from "../src/adapter.js";
import { xChannel } from "../src/channel.js";

const ENV = {
  APP_X_USER_ID: "u1",
  APP_X_USERNAME: "bot",
  APP_X_CLIENT_ID: "cid",
  APP_X_CLIENT_SECRET: "csec",
  APP_X_REFRESH_TOKEN: "rtok",
  APP_X_ALLOW_FROM: "1,2",
  APP_X_BEARER_TOKEN: "btok",
};
const VALUES = {
  userId: "u1",
  username: "bot",
  clientId: "cid",
  clientSecret: "csec",
  refreshToken: "rtok",
  allowFrom: "1,2",
  bearerToken: "btok",
};

const { refusal } = describeChannelContract({
  name: "xChannel",
  channel: xChannel,
  adapterClass: XAdapter,
  env: ENV,
  values: VALUES,
  requiredEnv: ["APP_X_USER_ID", "APP_X_USERNAME", "APP_X_CLIENT_ID", "APP_X_CLIENT_SECRET", "APP_X_REFRESH_TOKEN", "APP_X_ALLOW_FROM"],
  secretValues: ["csec", "rtok", "btok"],
  vitest,
  gateway,
});

vitest.describe("xChannel options", () => {
  const { expect, it } = vitest;

  it.each([null, 5, true, {}])(
    "refuses a non-string bearerToken %j with invalid_config",
    (value) => {
      const error = refusal({ ...VALUES, bearerToken: value });
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain("bearerToken");
    },
  );

  it("builds with the optional guest limit as a digit string or number", () => {
    expect(xChannel.create({ ...VALUES, guestDailyLimit: "5" })).toBeInstanceOf(XAdapter);
    expect(xChannel.create({ ...VALUES, allowFrom: ["1"], guestDailyLimit: 5 })).toBeInstanceOf(
      XAdapter,
    );
  });

  it.each(["0", "-1", "1.5", "abc", "", null, 0, true])("refuses guestDailyLimit %j", (value) => {
    const error = refusal({ ...VALUES, guestDailyLimit: value });
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("guestDailyLimit");
  });

  it.each([[], "", " , ", "1,,2", [" "], ["@"], ["1", " @ "], "@"])(
    "refuses allowFrom %j",
    (value) => {
      const error = refusal({ ...VALUES, allowFrom: value });
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain("allowFrom");
    },
  );
});
