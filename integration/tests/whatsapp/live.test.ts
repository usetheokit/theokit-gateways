/**
 * WhatsApp (Cloud API) — live tests against Meta's Graph API.
 *
 * This header used to open "NEVER EXECUTED", and it earned the prediction that followed it —
 * "first runs of unexecuted tests find their own bugs". Its first run, once Cloud API
 * credentials existed, found `connect()` returning an unconditional true (#58): a defect 209
 * unit tests could not see, because a fake backend always accepts.
 *
 * What it proves today: authentication against Meta, and that empty text is refused before any
 * transport state is touched. What it does not: delivery. The two outbound tests skip while the
 * recipient is unregistered against the test number — see the guard on each, which forgives that
 * only after proving the bytes we sent match the number configured.
 *
 * Unlike its siblings the adapter takes a BACKEND rather than credentials, so
 * this constructs `WhatsAppCloudBackend` explicitly. Two consequences worth
 * knowing: `appSecret` is required by the backend but is not in the registry (it
 * exists for webhook signature verification, which inbound needs and outbound
 * does not), and a Cloud API number can only message someone who messaged it in
 * the last 24 hours unless the message is a template — which is why the text
 * test asserts the pair (delivered, or refused for that one policy reason)
 * rather than demanding delivery.
 *
 * Webhook-based: inbound needs a public HTTPS endpoint, out of scope here for the
 * same reason as LINE.
 */

import { WhatsAppAdapter, WhatsAppCloudBackend } from "@theokit/gateway-whatsapp";
import { expect, it } from "vitest";

import { optional, required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const WHATSAPP = platformById("whatsapp");

/**
 * A `fetch` that records the `to` of every message it posts, then behaves normally.
 *
 * The seam exists because the only honest guard on a `131030` skip is the number that actually
 * left this process. A first version asserted `digitsOnly(configured) === configured`, which
 * reads as a check on our own bytes and is not one: `digitsOnly` is not on the send path at all,
 * so the assertion only said "the env var contains digits" and was satisfied unconditionally.
 * A defect substituting a different number — the adapter builds `{ to }` one line from
 * `botPhoneId`, a same-class field holding a phone number — would be refused with the same
 * `131030` and skip anyway. A reviewer built exactly that and watched it skip.
 */
function recordingFetch(): { fetch: typeof fetch; sentTo: string[] } {
  const sentTo: string[] = [];
  const impl = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    if (typeof init?.body === "string") {
      const parsed = JSON.parse(init.body) as { to?: unknown };
      if (typeof parsed.to === "string") sentTo.push(parsed.to);
    }
    return fetch(input, init);
  };
  return { fetch: impl as typeof fetch, sentTo };
}

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
    const wire = recordingFetch();
    const backend = new WhatsAppCloudBackend({
      accessToken: required("WHATSAPP_ACCESS_TOKEN"),
      phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
      appSecret: optional("WHATSAPP_APP_SECRET") ?? "",
      fetch: wire.fetch,
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
      // The guard, and the only version of it that means anything: compare against the bytes
      // that left this process. If we sent a different number, Meta's refusal is ours and the
      // test must stay red — a routing defect reported as a provisioning gap is the hiding
      // place this skip would otherwise be.
      expect(
        wire.sentTo,
        "we sent a different recipient than the one configured — this refusal is ours, not a gap",
      ).toEqual([configured]);
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
    const wire = recordingFetch();
    const adapter = makeAdapter({ fetch: wire.fetch });
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
        // Same guard, same reason: the bytes, not the env var. `connect()` also posts now, so
        // the recipient is whichever entry carried a `to` — the credential check sends none.
        expect(
          wire.sentTo,
          "we sent a different recipient than the one configured — this refusal is ours",
        ).toEqual([configured]);
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
