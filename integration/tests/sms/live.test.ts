/**
 * SMS (Twilio) — live tests against the real provider.
 *
 * NEVER EXECUTED. No SMS credentials exist for this project, so every test here
 * skips naming the variable it wants. Read it as a declared gap rather than as
 * coverage; first runs of unexecuted tests find their own bugs.
 *
 * Written against the Twilio variant of `SMSAdapterOptions`, because the
 * registry's `SMS_BACKEND` defaults there and a union cannot be constructed
 * generically. A project on Plivo or Vonage adapts this file rather than
 * parameterising it — three shapes with different field names do not share one
 * useful abstraction, and inventing one before the second real case exists is
 * the kind of generality the parsimony ladder rejects.
 *
 * SMS COSTS MONEY PER MESSAGE. The outbound test sends exactly one, to a number
 * the registry requires to be a throwaway. That is also why this suite has no
 * splitting test: proving a long message splits correctly would mean paying for
 * several segments to assert what the unit suite already covers deterministically.
 *
 * Webhook-based: inbound needs a public HTTPS endpoint, out of scope here for the
 * same reason as LINE.
 */

import { SMSAdapter } from "@theokit/gateway-sms";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const SMS = platformById("sms");

function makeAdapter(overrides: Record<string, unknown> = {}): SMSAdapter {
  return new SMSAdapter({
    backend: "twilio",
    accountSid: required("SMS_ACCOUNT_ID"),
    authToken: required("SMS_AUTH_TOKEN"),
    fromNumber: required("SMS_FROM_NUMBER"),
    // Only the inbound signature verifier reads this, and inbound is out of
    // scope here — so an empty string beats inventing a URL nobody serves.
    publicUrl: optional("INTEGRATION_PUBLIC_URL") ?? "",
    ...overrides,
  } as ConstructorParameters<typeof SMSAdapter>[0]);
}

describeLive(
  SMS,
  "authentication",
  () => {
    it("connects with real provider credentials", async () => {
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on credentials the provider rejects", async () => {
      const adapter = makeAdapter({ authToken: "definitely-not-a-real-token" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(SMS, "outbound", () => {
  it("delivers one message to the test number", async () => {
    // ONE message, deliberately. Every run of this test costs real money.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("SMS_TEST_RECIPIENT"), type: "dm" },
        text: `${marker} ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("refuses empty text without calling the provider", async () => {
    // Costs nothing: the adapter refuses before it opens a request.
    const adapter = makeAdapter();
    const result = await adapter.sendMessage({
      channel: { id: required("SMS_TEST_RECIPIENT"), type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  }, 30_000);
});
