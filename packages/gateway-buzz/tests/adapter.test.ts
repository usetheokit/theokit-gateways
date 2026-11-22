import { describe, expect, it } from "vitest";

import { describeRealtimeBotAdapter } from "../../../shared/realtime-bot-adapter-cases.js";
import { BuzzAdapter, splitForBuzz } from "../src/index.js";
import { FakeSocket, fakeFetch, message } from "./fakes.js";

describeRealtimeBotAdapter(
  {
    describe,
    it,
    expect,
    Adapter: BuzzAdapter,
    split: splitForBuzz,
    FakeSocket,
    fakeFetch,
    message,
  },
  { platform: "buzz", title: "BuzzAdapter", token: "bz_secret" },
);
