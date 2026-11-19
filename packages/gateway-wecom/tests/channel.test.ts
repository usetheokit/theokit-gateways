import * as gateway from "@theokit/gateway";
import * as vitest from "vitest";

import { describeChannelContract } from "../../../test-support/channel-contract.js";
import { WeComAdapter } from "../src/adapter.js";
import { wecomChannel } from "../src/channel.js";

const ENV = {
  APP_WECOM_CORP_ID: "c",
  APP_WECOM_CORP_SECRET: "s",
  APP_WECOM_AGENT_ID: "1000002",
  APP_WECOM_TOKEN: "t",
  APP_WECOM_ENCODING_AES_KEY: "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
};
const VALUES = {
  corpId: "c",
  corpSecret: "s",
  agentId: "1000002",
  token: "t",
  encodingAesKey: "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
};

const { refusal } = describeChannelContract({
  name: "wecomChannel",
  channel: wecomChannel,
  adapterClass: WeComAdapter,
  env: ENV,
  values: VALUES,
  requiredEnv: ["APP_WECOM_CORP_ID", "APP_WECOM_CORP_SECRET", "APP_WECOM_AGENT_ID", "APP_WECOM_TOKEN", "APP_WECOM_ENCODING_AES_KEY"],
  secretValues: ["s", "t", "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"],
  vitest,
  gateway,
});

vitest.describe("wecomChannel options", () => {
  const { expect, it } = vitest;

  it("accepts agentId as a number or a digit string and refuses other shapes", () => {
    expect(wecomChannel.create({ ...VALUES, agentId: 1000002 })).toBeInstanceOf(WeComAdapter);
    expect(refusal({ ...VALUES, agentId: "abc" }).message).toContain("agentId");
  });

  it("refuses a digit-string agentId beyond the safe integer range", () => {
    expect(refusal({ ...VALUES, agentId: "9".repeat(400) }).message).toContain("agentId");
    expect(refusal({ ...VALUES, agentId: "9007199254740993" }).message).toContain("agentId");
  });
});
