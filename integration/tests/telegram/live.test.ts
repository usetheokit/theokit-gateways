/**
 * Telegram — live tests against api.telegram.org with a real bot token.
 *
 * This is the reference implementation the other nine platforms follow. What it
 * asserts is deliberately not "the adapter's unit tests, again over the wire":
 * the unit suite already covers splitting, filtering and normalization against
 * fakes. What only a real API can tell us is whether the CONTRACT we coded
 * against still matches the one the platform serves — that our auth reaches it,
 * that our payload shape is accepted, and that a real error maps to the error
 * we claim to return.
 *
 * Every message carries a run marker, so anything that escapes into a real chat
 * is identifiable as test traffic.
 *
 * The target is a DM with the bot, so `channel.type` is "dm". The adapter does
 * not branch on type when sending — it needs the numeric chat id and nothing
 * else — so declaring "group" here passed just as well. It was still wrong, and
 * a test that states something false about its own fixture is a test that will
 * mislead the next person to read it, whether or not today's code notices.
 */

import { TelegramAdapter } from "@theokit/gateway-telegram";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const TELEGRAM = platformById("telegram");

describeLive(
  TELEGRAM,
  "authentication",
  () => {
    it("connect() succeeds against the real API with a valid token", async () => {
      const adapter = new TelegramAdapter({ token: required("TELEGRAM_BOT_TOKEN") });
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    });

    it("connect() returns false — never throws — on a token the API rejects", async () => {
      // EC-I is only meaningful against a real 401. A fake can be told to reject;
      // only Telegram can tell us the shape it actually rejects with, and that our
      // handler still catches it.
      const adapter = new TelegramAdapter({ token: "123456:definitely-not-a-real-token" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    });
  },
  // Authenticating writes nothing, so it needs the token and not a test chat.
  { sends: false },
);

describeLive(TELEGRAM, "outbound", () => {
  it("delivers a message to the test chat and returns its id", async () => {
    const adapter = new TelegramAdapter({ token: required("TELEGRAM_BOT_TOKEN") });
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("TELEGRAM_TEST_CHAT_ID"), type: "dm" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.messageId).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  });

  it("splits a message over Telegram's 4096-char cap into several real sends", async () => {
    // The split logic is unit-tested. What is NOT unit-testable is whether
    // Telegram accepts each part we produce — a chunk one byte over the cap comes
    // back 400, and only the real API says so.
    const adapter = new TelegramAdapter({ token: required("TELEGRAM_BOT_TOKEN") });
    const marker = runMarker();
    try {
      await adapter.connect();
      const long = `${marker} ${"paragraph.\n\n".repeat(500)}`;
      const result = await adapter.sendMessage({
        channel: { id: required("TELEGRAM_TEST_CHAT_ID"), type: "dm" },
        text: long,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 60_000);

  it("maps a rejected chat id to a structured error rather than throwing", async () => {
    const adapter = new TelegramAdapter({ token: required("TELEGRAM_BOT_TOKEN") });
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: "-1000000000000", type: "group" },
        text: "this chat does not exist",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBeDefined();
      // The message is for a human reading logs; it must not be empty.
      expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  });

  it("refuses empty text without calling the API", async () => {
    const adapter = new TelegramAdapter({ token: required("TELEGRAM_BOT_TOKEN") });
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("TELEGRAM_TEST_CHAT_ID"), type: "dm" },
        text: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("empty_text");
    } finally {
      await adapter.disconnect();
    }
  });
});

describeLiveInbound(TELEGRAM, "inbound round trip", () => {
  it("receives a message a real user posted into the test chat", async () => {
    // Telegram is connection-based: the bot long-polls, so this round trip needs
    // no public URL and runs unattended in CI.
    //
    // The sender has to be a USER, not a second bot. Telegram's Bot FAQ:
    // "bots will not be able to see messages from other bots regardless of
    // mode". A second bot token would post successfully and the gateway would
    // never see it, so that suite could not pass however long it waited — the
    // first version of this file got that wrong.
    //
    // `TELEGRAM_TEST_SESSION` is an MTProto session string for a throwaway user
    // account, minted once by `pnpm --filter @theokit/gateway-integration
    // session:telegram`. After that one login there is no human in the loop.
    const session = optional("TELEGRAM_TEST_SESSION");
    if (session === undefined) {
      // DELIBERATELY UNSET, decided 2026-08-17 — not a task nobody got to.
      //
      // An MTProto session string is full access to the account it belongs to,
      // not a scoped token, so putting one in CI means anyone with repository
      // access has the account. Weighed against what it buys — one inbound
      // assertion on a platform whose auth and outbound are already covered —
      // the owner chose the gap. Set TELEGRAM_TEST_SESSION on a THROWAWAY
      // account (see integration/README.md) if that trade ever changes.
      //
      // Until 2026-08-22 this comment was the ONLY thing carrying that decision,
      // while `.github/workflows/integration.yml` had TELEGRAM_TEST_SESSION
      // declared and piped into both steps. A comment cannot stop anything: the
      // sole barrier was that nobody had filled the secret in, and whoever did
      // would have shipped an account credential into CI with no review. The
      // workflow no longer references it, so the decision is now enforced by the
      // absence of a wire rather than by someone reading this paragraph first.
      expect
        .soft(session, "Telegram inbound is intentionally uncovered — see the comment above")
        .toBeUndefined();
      return;
    }

    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions/index.js");

    const adapter = new TelegramAdapter({ token: required("TELEGRAM_BOT_TOKEN") });
    const chatId = required("TELEGRAM_TEST_CHAT_ID");
    const marker = runMarker();
    const seen: string[] = [];

    const user = new TelegramClient(
      new StringSession(session),
      Number(required("TELEGRAM_API_ID")),
      required("TELEGRAM_API_HASH"),
      { connectionRetries: 3 },
    );

    try {
      adapter.onInbound(async (event) => {
        seen.push(event.text);
      });
      await adapter.connect();

      await user.connect();
      await user.sendMessage(chatId, { message: `${marker} inbound probe` });

      await waitFor(() => seen.find((t) => t.includes(marker)), {
        timeoutMs: 30_000,
        label: `an inbound message containing ${marker}`,
      });
    } finally {
      await user.disconnect();
      await adapter.disconnect();
    }
  }, 90_000);
});
