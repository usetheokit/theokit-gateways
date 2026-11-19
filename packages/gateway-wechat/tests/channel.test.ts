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
  vitest,
  gateway,
});
