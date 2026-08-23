/**
 * WhatsApp (Cloud API) — live tests against Meta's Graph API.
 *
 * NEVER EXECUTED. No WhatsApp credentials exist for this project, so every test
 * here skips naming the variable it wants. Read it as a declared gap rather than
 * as coverage; first runs of unexecuted tests find their own bugs.
 *
 * Unlike its siblings the adapter takes a BACKEND rather than credentials, so
 * this constructs `WhatsAppCloudBackend` explicitly. Two consequences worth
 * knowing before someone provisions this: `appSecret` is required by the backend
 * but is not in the registry (it exists for webhook signature verification, which
 * inbound needs and outbound does not), and a Cloud API number can only message
 * someone who messaged it in the last 24 hours unless the message is a template.
 * An outbound test against a cold recipient will fail for policy, not for code.
 *
 * Webhook-based: inbound needs a public HTTPS endpoint, out of scope here for the
 * same reason as LINE.
 */

import { digitsOnly, WhatsAppAdapter, WhatsAppCloudBackend } from "@theokit/gateway-whatsapp";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const WHATSAPP = platformById("whatsapp");

function makeAdapter(overrides: Record<string, unknown> = {}): WhatsAppAdapter {
  const backend = new WhatsAppCloudBackend({
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    // Not in the registry: it verifies webhook signatures, which only inbound
    // uses. Outbound works without it, so an empty string keeps the constructor
    // honest instead of inventing a credential nobody provisioned.
    appSecret: optional("WHATSAPP_APP_SECRET") ?? "",
    ...overrides,
  });
  return new WhatsAppAdapter(backend, { botPhoneId: required("WHATSAPP_PHONE_NUMBER_ID") });
}

describeLive(
  WHATSAPP,
  "authentication",
  () => {
    it("connects with a real access token", async () => {
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on a token Meta rejects", async () => {
      const adapter = makeAdapter({ accessToken: "definitely-not-a-real-token" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(WHATSAPP, "outbound", () => {
  it("delivers a template, the send that does not depend on a 24-hour window", async (ctx) => {
    // THE outbound check. Free-form text only reaches someone who wrote in the
    // last 24 hours, which cannot be arranged unattended — so a suite built on it
    // reports a policy refusal as a red build and answers "is WhatsApp working?"
    // with "nobody can tell". A template has no such condition.
    //
    // `hello_world` is pre-approved on every WhatsApp Business account, so this
    // needs no template of our own. Override with WHATSAPP_TEMPLATE_NAME /
    // WHATSAPP_TEMPLATE_LANGUAGE if the account uses a different one.
    const backend = new WhatsAppCloudBackend({
      accessToken: required("WHATSAPP_ACCESS_TOKEN"),
      phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
      appSecret: optional("WHATSAPP_APP_SECRET") ?? "",
    });

    const result = await backend.sendTemplate(
      required("WHATSAPP_TEST_RECIPIENT"),
      optional("WHATSAPP_TEMPLATE_NAME") ?? "hello_world",
      optional("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en_US",
    );

    // A test number may only message recipients registered against it one by one in the app's
    // API setup, and there is no Graph endpoint for that list — it is a console step. That is
    // incomplete configuration, exactly like a missing credential, and this suite already skips
    // whole platforms for those rather than reporting them red. A permanent red for a
    // provisioning gap blocks the release gate forever or trains people to ignore the suite,
    // which is the failure the sibling test below was rewritten to avoid.
    //
    // The guard against that becoming a hiding place: a recipient WE mangled would be refused
    // the same way. So this only forgives 131030 after proving the number we were told to send
    // survives our own normalisation unchanged. If it does not, the fault is ours and stays red.
    if (result.error?.code === "recipient_not_allowlisted") {
      const configured = required("WHATSAPP_TEST_RECIPIENT");
      expect(
        digitsOnly(configured),
        "we normalised the recipient into a different number — this refusal is ours, not a gap",
      ).toBe(configured);
      ctx.skip(
        `WHATSAPP_TEST_RECIPIENT (${configured}) is not registered against the test number. ` +
          "Add it under the phone number in the app's WhatsApp API setup, then re-run.",
      );
    }

    expect(result.ok, `template send failed: ${result.error?.code} ${result.error?.message}`).toBe(
      true,
    );
    expect(result.wamid).toBeDefined();
  }, 45_000);

  it("either delivers free-form text or names the 24-hour window as the reason", async (ctx) => {
    // Text CAN legitimately be refused here, and the previous version of this test
    // asserted `ok === true` while its own comment admitted that. A red that means
    // "the recipient has not written recently" is a red nobody can act on, and it
    // trains people to ignore the suite.
    //
    // So the assertion is on the pair: either it went out, or Meta refused it for
    // the one documented policy reason and our mapper said so. Anything else — an
    // auth failure, a malformed payload, a code we do not recognise — is a defect,
    // and this now distinguishes them.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("WHATSAPP_TEST_RECIPIENT"), type: "dm" },
        text: `${marker} outbound ok`,
      });
      if (result.ok) {
        expect(result.messageId).toBeDefined();
        return;
      }
      // Same distinction as the template test above: an unregistered recipient is configuration,
      // and it is proven to be configuration rather than our own mangling before it is forgiven.
      if (result.error?.code === "recipient_not_allowlisted") {
        const configured = required("WHATSAPP_TEST_RECIPIENT");
        expect(digitsOnly(configured), "we mangled the recipient — this refusal is ours").toBe(
          configured,
        );
        ctx.skip(
          `WHATSAPP_TEST_RECIPIENT (${configured}) is not registered against the test number.`,
        );
      }
      expect(
        result.error?.code,
        `text was refused for something other than the service window: ${result.error?.message}`,
      ).toBe("session_window_expired");
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("refuses empty text without calling the API", async () => {
    const adapter = makeAdapter();
    const result = await adapter.sendMessage({
      channel: { id: required("WHATSAPP_TEST_RECIPIENT"), type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  }, 30_000);
});
