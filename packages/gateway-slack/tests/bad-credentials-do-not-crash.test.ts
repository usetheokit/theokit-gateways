/**
 * A bad Slack credential must make connect() resolve false without leaving an
 * unhandled rejection behind (Bolt's eager constructor auth.test, #389).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { badBot: false, badApp: false };

vi.mock("@slack/bolt", () => {
  const invalid = () =>
    Object.assign(new Error("An API error occurred: invalid_auth"), {
      code: "slack_webapi_platform_error",
    });
  class MockApp {
    public client = {
      auth: {
        test: async () => {
          if (state.badBot) throw invalid();
          return { user_id: "UBOT1234" };
        },
      },
    };
    // Mimics Bolt: the constructor starts auth.test and keeps the promise.
    private pending: Promise<unknown> | undefined;
    constructor(opts: { tokenVerificationEnabled?: boolean }) {
      if (opts.tokenVerificationEnabled !== false) {
        this.pending = this.client.auth.test();
      }
    }
    event = vi.fn();
    start = async () => {
      if (state.badApp) throw invalid();
    };
    stop = async () => undefined;
  }
  return { default: { App: MockApp }, App: MockApp };
});

import { SlackAdapter } from "../src/adapter.js";

const seen: unknown[] = [];
const spy = (reason: unknown) => {
  seen.push(reason);
};

beforeEach(() => {
  seen.length = 0;
  process.on("unhandledRejection", spy);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  process.off("unhandledRejection", spy);
  vi.restoreAllMocks();
});

describe("bad Slack credentials do not crash", () => {
  const cases: Array<[string, boolean, boolean]> = [
    ["both tokens bad", true, true],
    ["only the bot token bad", true, false],
    ["only the app token bad", false, true],
  ];
  for (const [name, badBot, badApp] of cases) {
    it(`${name}: connect resolves false, no unhandled rejection`, async () => {
      state.badBot = badBot;
      state.badApp = badApp;
      const a = new SlackAdapter({ botToken: "xoxb-bad", appToken: "xapp-bad" });
      expect(await a.connect()).toBe(false);
      await new Promise((r) => setTimeout(r, 50));
      expect(seen).toEqual([]);
      const writes = vi
        .mocked(process.stderr.write)
        .mock.calls.filter((c) => String(c[0]).includes("[slack-adapter] connect failed"));
      expect(writes).toHaveLength(1);
    });
  }
});
