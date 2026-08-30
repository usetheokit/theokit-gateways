/**
 * Email — live tests against a real IMAP + SMTP server.
 *
 * Email is the platform where a fake is least trustworthy, because "IMAP" is not
 * one protocol in practice: Gmail exposes labels as folders, keeps a synthetic
 * `[Gmail]/All Mail`, and answers some standard commands in its own way. A fake
 * built from the RFC agrees with the RFC. Only the server tells you whether the
 * mailbox this adapter opens is the mailbox the user's mail actually lands in.
 *
 * The round trip needs TWO mailboxes, not one. Mailing itself was the obvious
 * design and it cannot work: the adapter drops own-address mail before anything
 * else (EC-1), because a bot that answers its own mail loops by email, and an
 * email loop does not stop when the process does.
 *
 * It is also the slowest platform here — delivery is not instant, so the inbound
 * assertion polls with a wide timeout instead of pretending otherwise.
 *
 * The per-test timeouts are large because `connect()` against this mailbox costs
 * around two minutes. Measured 2026-08-18, decomposed:
 *
 *   IMAP connect + login  73.6s
 *   mailboxOpen("INBOX")  39.2s
 *   search UNSEEN         12.4s
 *   SMTP verify            1.3s
 *
 * CORRECTION. An earlier version of this comment blamed `_drainUnseen()` —
 * connect was timed at 114.4s with 171 unread, a plain login at 11.7s, and the
 * backlog was read as the cause. It was not. With the mailbox at ZERO unread,
 * connect still takes 109.5s, and the decomposition above puts the cost in
 * Gmail's own IMAP login and INBOX open. Two measurements taken minutes apart
 * put the login at 38.2s and 73.6s, so the variance alone is wider than the
 * effect that was attributed to the drain.
 *
 * The lesson is worth more than the number: the first reading was a correlation
 * (slow connect, large backlog) written down as a cause. Draining the backlog
 * fixed a real defect — issue #11, redelivery on every reconnect — and left the
 * timing essentially where it was.
 */

import { EmailAdapter, type EmailMessageEvent } from "@theokit/gateway-email";
import { afterAll, expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const EMAIL = platformById("email");

function makeAdapter(overrides: Record<string, unknown> = {}): EmailAdapter {
  return new EmailAdapter({
    address: required("EMAIL_ADDRESS"),
    password: required("EMAIL_PASSWORD"),
    imapHost: required("EMAIL_IMAP_HOST"),
    smtpHost: required("EMAIL_SMTP_HOST"),
    // Gmail's app-password SMTP wants implicit TLS on 465; 587 STARTTLS also
    // works, but 465 fails faster when the credential is wrong, which is the
    // behaviour worth having in a test.
    smtpPort: 465,
    // The probe mails itself, and `noreply`-style filtering (D332) would not
    // apply — but allowedSenders must stay open or the round trip drops its own
    // message before the assertion sees it.
    allowAutomated: true,
    ...overrides,
  });
}

/**
 * ONE connection shared by every test that merely needs a connected adapter.
 *
 * Gmail throttles repeated IMAP logins, and the suite was paying that toll five
 * times per run. Measured on the same mailbox within one day: a login took 38.2s,
 * then 73.6s, and finally four consecutive logins failed to finish inside ten
 * minutes at all. That is what failed the release gate on 2026-08-18 — two email
 * tests timed out while the other fifty passed, and nothing was wrong with the
 * product.
 *
 * Lazily created, which also settles the awkward case: a run where the live
 * suites skip never calls this, so it never opens a connection it does not need.
 *
 * The tests stay independent in the way that matters — each sends its own marker
 * and asserts on its own message. What they share is the transport, which is a
 * fixture, not shared state under test. The two tests that assert on `connect()`
 * itself deliberately keep their own adapter; they are testing the thing this
 * helper is caching.
 */
let shared: EmailAdapter | undefined;
const inbox: string[] = [];

async function connectedAdapter(): Promise<EmailAdapter> {
  if (shared === undefined) {
    const adapter = makeAdapter();
    adapter.onInbound(async (event) => {
      const email = event as EmailMessageEvent;
      inbox.push(`${email.email?.subject ?? ""} ${email.text}`);
    });
    // Checking the return value is the difference between one honest failure
    // and five confusing ones. `connect()` reports failure by returning false,
    // so an unchecked call caches a disconnected adapter and every test after
    // it fails on a symptom instead of the cause.
    const ok = await adapter.connect();
    if (!ok) throw new Error("email connect() returned false — credentials or host wrong");
    shared = adapter;
  }
  return shared;
}

afterAll(async () => {
  await shared?.disconnect();
  shared = undefined;
});

describeLive(
  EMAIL,
  "authentication",
  () => {
    it("connects to both IMAP and SMTP with the real credentials", async () => {
      // One connect() covers two servers, and this asserts the shared login
      // rather than opening a second one. Its own login is what failed the
      // release gate on 2026-08-18: Gmail throttles repeated IMAP logins hard
      // enough that a single one can outlast 180s, and paying for it twice to
      // assert the same fact was the whole problem.
      //
      // `connectedAdapter()` throws when connect() returns false, so this test
      // is where that failure gets a name instead of five downstream symptoms.
      await expect(connectedAdapter()).resolves.toBeDefined();
    }, 420_000);

    it("returns false rather than throwing on a password the server rejects", async () => {
      // Keeps its own adapter, necessarily: it is asserting on connect() with a
      // credential the shared one must never carry. A rejected login is also
      // the fast path — the server refuses instead of throttling.
      const adapter = makeAdapter({ password: "nnnnnnnnnnnnnnnn" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 180_000);
  },
  { sends: false },
);

describeLive(EMAIL, "outbound", () => {
  it("sends a message the SMTP server accepts, and returns its id", async () => {
    const adapter = await connectedAdapter();
    const marker = runMarker();
    const result = await adapter.sendMessage({
      channel: { id: required("EMAIL_TEST_RECIPIENT"), type: "dm" },
      text: `${marker} outbound ok`,
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.messageId).toBeDefined();
  }, 180_000);

  it("maps an undeliverable recipient into a structured error", async () => {
    // Gmail rejects a malformed recipient at RCPT TO, synchronously. A domain
    // that merely does not exist would bounce later and asynchronously, which no
    // test can wait for — so the assertion targets the synchronous refusal.
    const adapter = await connectedAdapter();
    const result = await adapter.sendMessage({
      channel: { id: "not-an-address", type: "dm" },
      text: "this address is not deliverable",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBeDefined();
    expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
  }, 180_000);

  it("refuses empty text without opening an SMTP transaction", async () => {
    // Deliberately does NOT connect. `sendMessage` checks `text.length === 0`
    // before it looks at the connection, so the refusal is observable without
    // one — and connecting here would cost the 114s drain for nothing, which is
    // what it used to do. Skipping it makes the test both faster and a sharper
    // statement: empty text is refused by the adapter, not by the transport.
    const adapter = makeAdapter();
    const result = await adapter.sendMessage({
      channel: { id: required("EMAIL_TEST_RECIPIENT"), type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  }, 30_000);
});

describeLiveInbound(EMAIL, "inbound round trip", () => {
  it("reads back over IMAP a message sent from a different address", async () => {
    // The whole gateway in one assertion: the provider's delivery, the IMAP
    // watcher, UID tracking, and normalization. Nothing in the unit suite can
    // substitute for it, because every one of those is faked there.
    //
    // The sender must NOT be the bot's own address. `adapter.ts` drops
    // own-address mail before anything else (EC-1, critical): without that guard
    // a bot that replies to its own mail loops forever, and the loop is by email,
    // so it does not stop when the process does.
    //
    // The first version of this test had the bot mail ITSELF, which cannot work
    // for exactly that reason. It is the same mistake as driving Telegram
    // inbound with a second bot and Slack inbound with the bot token: every one
    // of those platforms has a loop guard, and every one of them makes the
    // obvious probe invisible. A round trip needs a second identity — that is
    // the rule, not the exception.
    const senderAddress = optional("EMAIL_TEST_SENDER_ADDRESS");
    const senderPassword = optional("EMAIL_TEST_SENDER_PASSWORD");
    if (senderAddress === undefined || senderPassword === undefined) {
      expect
        .soft(
          senderAddress,
          "set EMAIL_TEST_SENDER_ADDRESS/PASSWORD to a SECOND mailbox — the bot cannot mail itself (EC-1)",
        )
        .toBeUndefined();
      return;
    }

    // The shared adapter is already connected and already has a handler feeding
    // `inbox`, so the probe is matched by marker rather than by owning the only
    // handler. That is what keeps this test independent while sharing a login.
    const marker = runMarker();
    await connectedAdapter();

    {
      const { createTransport } = await import("nodemailer");
      const sender = createTransport({
        host: optional("EMAIL_TEST_SENDER_SMTP_HOST") ?? required("EMAIL_SMTP_HOST"),
        port: 465,
        secure: true,
        auth: { user: senderAddress, pass: senderPassword },
      });
      await sender.sendMail({
        from: senderAddress,
        to: required("EMAIL_ADDRESS"),
        subject: `${marker} inbound probe`,
        text: `${marker} inbound probe`,
      });

      // Delivery is usually seconds, but "usually" is not a contract.
      await waitFor(() => inbox.find((line) => line.includes(marker)), {
        timeoutMs: 120_000,
        intervalMs: 2_000,
        label: `an inbound email containing ${marker}`,
      });
    }
    // 420s = connect (~110s, see the file header) + delivery + the 120s poll,
    // with room for Gmail's login latency, which was measured at 38.2s and
    // 73.6s minutes apart on the same mailbox.
    //
    // This budget was first raised from 180s "until issue #11 lands". #11 has
    // landed and the number stays, because the premise was wrong: the cost is
    // Gmail's IMAP, not our backlog. Lowering it now would only make the suite
    // fail on a slow login.
  }, 420_000);
});
