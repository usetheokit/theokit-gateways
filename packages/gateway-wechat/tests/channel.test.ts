import * as gateway from "@theokit/gateway";
import * as vitest from "vitest";

import { describeChannelContract } from "../../../test-support/channel-contract.js";
import { WeChatAdapter } from "../src/adapter.js";
import { wechatChannel } from "../src/channel.js";

const ENV = {
  APP_WECHAT_APP_ID: "a",
  APP_WECHAT_APP_SECRET: "s",
  APP_WECHAT_TOKEN: "t",
};
const VALUES = {
  appId: "a",
  appSecret: "s",
  token: "t",
};

const { refusal } = describeChannelContract({
  name: "wechatChannel",
  channel: wechatChannel,
  adapterClass: WeChatAdapter,
  env: ENV,
  values: VALUES,
  requiredEnv: ["APP_WECHAT_APP_ID", "APP_WECHAT_APP_SECRET", "APP_WECHAT_TOKEN"],
  secretValues: ["s", "t"],
  vitest,
  gateway,
});

vitest.describe("wechatChannel descriptor", () => {
  vitest.it("declares its config fields with env bindings and secret flags", () => {
    const rows = wechatChannel.config.map((f) => [f.key, f.env, f.required, f.secret]);
    vitest.expect(rows).toEqual([
      ["appId", "WECHAT_APP_ID", true, false],
      ["appSecret", "WECHAT_APP_SECRET", true, true],
      ["token", "WECHAT_TOKEN", true, true],
    ]);
  });
});
