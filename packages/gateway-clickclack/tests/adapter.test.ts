import { describe, expect, it } from "vitest";

import { describeRealtimeBotAdapter } from "../../../shared/realtime-bot-adapter-cases.js";
import { ClickClackAdapter, splitForClickClack } from "../src/index.js";
import { FakeSocket, fakeFetch, message } from "./fakes.js";

describeRealtimeBotAdapter(
  {
    describe,
    it,
    expect,
    Adapter: ClickClackAdapter,
    split: splitForClickClack,
    FakeSocket,
    fakeFetch,
    message,
  },
  { platform: "clickclack", title: "ClickClackAdapter", token: "ccb_secret" },
);
