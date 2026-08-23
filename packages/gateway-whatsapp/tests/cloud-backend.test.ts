/**
 * `WhatsAppCloudBackend` tests (T2.3).
 */

import * as crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { WhatsAppCloudBackend } from "../src/backend/cloud/index.js";

const APP_SECRET = "test-secret";

function makeFetchOk(): typeof fetch {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.x" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  ) as typeof fetch;
}

function signedHeader(body: string): string {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

function makeBackend(fetchImpl: typeof fetch = makeFetchOk()): WhatsAppCloudBackend {
  return new WhatsAppCloudBackend({
    accessToken: "t",
    phoneNumberId: "PNID",
    appSecret: APP_SECRET,
    fetch: fetchImpl,
  });
}

const TEXT_ENVELOPE = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "e",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "5511", phone_number_id: "PNID" },
            messages: [
              {
                from: "5511888",
                id: "wamid.in.1",
                timestamp: "1700",
                type: "text",
                text: { body: "hi" },
              },
            ],
          },
        },
      ],
    },
  ],
});

describe("WhatsAppCloudBackend", () => {
  it("refuses a credential that resolves to a node other than the configured number", async () => {
    // This test used to be `test_cloud_backend_connect_noop_returns_true` and asserted that
    // `connect()` is a no-op returning true. It was the defect's own specification: a test
    // written to describe the shortcut rather than the contract, and green for as long as the
    // shortcut lived (#58).
    //
    // `makeFetchOk()` answers with a message-send envelope, which has no `id` matching the
    // configured phone number — the same shape a WABA id in the wrong field produces, and now
    // correctly refused.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(await makeBackend().connect()).toBe(false);

    stderr.mockRestore();
  });

  it("test_cloud_backend_send_delegates_to_client", async () => {
    const fakeFetch = makeFetchOk();
    const b = makeBackend(fakeFetch);
    const r = await b.send({ to: "5511", isGroup: false, text: "hi" });
    expect(r.ok).toBe(true);
    expect(r.wamid).toBe("wamid.x");
    expect((fakeFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("test_cloud_backend_handle_webhook_invalid_signature_no_dispatch", async () => {
    const b = makeBackend();
    const handler = vi.fn(async () => {});
    b.onInbound(handler);
    const ok = await b.handleWebhookPayload(TEXT_ENVELOPE, "sha256=DEADBEEF".padEnd(71, "0"));
    expect(ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("test_cloud_backend_handle_webhook_valid_dispatches_to_inbound_handler", async () => {
    const b = makeBackend();
    const handler = vi.fn(async () => {});
    b.onInbound(handler);
    const ok = await b.handleWebhookPayload(TEXT_ENVELOPE, signedHeader(TEXT_ENVELOPE));
    expect(ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const firstCall = handler.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect((firstCall as unknown[])[0]).toMatchObject({ text: "hi" });
  });

  it("test_cloud_backend_handle_webhook_dispatches_status_receipts", async () => {
    const statusEnv = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "x", phone_number_id: "PNID" },
                statuses: [
                  { id: "wamid.s", status: "delivered", timestamp: "1700", recipient_id: "5511" },
                ],
              },
            },
          ],
        },
      ],
    });
    const b = makeBackend();
    const inboundH = vi.fn(async () => {});
    const statusH = vi.fn(async () => {});
    b.onInbound(inboundH);
    b.onStatusReceipt(statusH);
    const ok = await b.handleWebhookPayload(statusEnv, signedHeader(statusEnv));
    expect(ok).toBe(true);
    expect(inboundH).not.toHaveBeenCalled();
    expect(statusH).toHaveBeenCalledTimes(1);
    const firstCall = statusH.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect((firstCall as unknown[])[0]).toMatchObject({ status: "delivered" });
  });
});

describe("WhatsAppCloudBackend — a throwing handler", () => {
  /** Two inbound messages plus a delivery receipt, all in one webhook — Meta batches. */
  const BATCH_ENVELOPE = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "e",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5511", phone_number_id: "PNID" },
              messages: [
                {
                  from: "5511888",
                  id: "wamid.in.1",
                  timestamp: "1700",
                  type: "text",
                  text: { body: "first" },
                },
                {
                  from: "5511888",
                  id: "wamid.in.2",
                  timestamp: "1701",
                  type: "text",
                  text: { body: "second" },
                },
              ],
              statuses: [
                {
                  id: "wamid.out.1",
                  status: "delivered",
                  timestamp: "1702",
                  recipient_id: "5511888",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  it("does not abandon the rest of the batch when one message's handler throws", async () => {
    // Meta delivers several messages in one webhook. The loop awaited the handler with nothing
    // around it, so a throw on the first message skipped every message after it AND every status
    // receipt in the same payload (#41).
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const b = makeBackend();
    const seen: string[] = [];
    const receipts: string[] = [];
    b.onInbound(async (event) => {
      seen.push(event.text);
      throw new Error("user handler blew up");
    });
    b.onStatusReceipt(async (receipt) => {
      receipts.push(receipt.status);
    });

    await b.handleWebhookPayload(BATCH_ENVELOPE, signedHeader(BATCH_ENVELOPE));

    expect(seen).toEqual(["first", "second"]);
    expect(receipts).toEqual(["delivered"]);
    stderr.mockRestore();
  });

  it("still answers the webhook, so the platform does not redeliver what already succeeded", async () => {
    // The user returns this boolean as their HTTP status. Rejecting makes the route 500, Meta
    // retries the whole payload, and every message that HAD been handled is handled again — the
    // duplicate-reply failure, arriving through a different door than #11.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const b = makeBackend();
    b.onInbound(async () => {
      throw new Error("user handler blew up");
    });

    await expect(
      b.handleWebhookPayload(BATCH_ENVELOPE, signedHeader(BATCH_ENVELOPE)),
    ).resolves.toBe(true);
    stderr.mockRestore();
  });

  it("answers false on a signed body that is not JSON, instead of rejecting", async () => {
    // `handleWebhookPayload` documents true/false; a throw is outside its contract, and the route
    // that called it has no reason to expect one.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const b = makeBackend();
    const notJson = "this is not json";

    await expect(b.handleWebhookPayload(notJson, signedHeader(notJson))).resolves.toBe(false);
    stderr.mockRestore();
  });
});

describe("WhatsAppCloudBackend — sendTemplate", () => {
  it("reaches a recipient who never wrote first, which text cannot", async () => {
    // Pillar (a) of the wiring triad: sendTemplate on the client is unreachable
    // unless something a consumer can hold delegates to it. The backend is that
    // thing — WhatsAppCloudClient is @internal and not exported.
    const fakeFetch = makeFetchOk();
    const b = makeBackend(fakeFetch);

    const result = await b.sendTemplate("5511", "hello_world", "en_US");

    expect(result.ok).toBe(true);
    const init = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.type).toBe("template");
    expect(body.template).toEqual({ name: "hello_world", language: { code: "en_US" } });
  });

  it("surfaces a template rejection as a structured error, never a throw", async () => {
    const b = makeBackend(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 132001, message: "no such template" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ) as typeof fetch,
    );

    const result = await b.sendTemplate("5511", "nope", "en_US");

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("no such template");
  });
});

describe("WhatsAppCloudBackend.connect — the check it never made (#58)", () => {
  it("returns false on a token Meta rejects, instead of reporting success", async () => {
    // It was `return true`, unconditionally. A consumer with a wrong, expired or revoked token
    // got success at startup and learned otherwise from messages that silently never arrived —
    // no error, no log, nothing to alert on. Found by the first live run of the WhatsApp suite;
    // 209 unit tests could not see it, because the fake backend always accepts.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rejecting = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "Invalid OAuth access token.", code: 190 } }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    expect(await makeBackend(rejecting).connect()).toBe(false);

    // And it says WHY. A supervisor told only "false" cannot tell a revoked token, which needs a
    // human, from a rate limit, which needs a wait.
    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("auth_failed");
    expect(written).toContain("Invalid OAuth access token");
    stderr.mockRestore();
  });

  it("returns true when Meta confirms the credential", async () => {
    const accepting = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "PNID", display_phone_number: "+1 555" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    expect(await makeBackend(accepting).connect()).toBe(true);
  });

  it("returns false rather than throwing when the network is down", async () => {
    // The contract every sibling adapter is tested against is that connect RETURNS false rather
    // than throwing — a throw at startup takes the whole runner down with it.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const offline = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND graph.facebook.com");
    }) as unknown as typeof fetch;

    await expect(makeBackend(offline).connect()).resolves.toBe(false);
    stderr.mockRestore();
  });

  it("verifies once and stays connected, instead of asking Meta on every call", async () => {
    // `connect()` is documented idempotent across this package. A verification per call would
    // turn a supervisor's health check into a rate-limit source against Meta.
    const accepting = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "PNID" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const backend = makeBackend(accepting);

    expect([await backend.connect(), await backend.connect()]).toEqual([true, true]);
    expect((accepting as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("WhatsAppCloudBackend.connect — concurrency", () => {
  it("verifies once when two callers connect at the same time", async () => {
    // The same shape fixed twice already in this package: a caller-count guard that only reads a
    // settled flag lets two simultaneous calls both do the work. Here that is two credential
    // checks against Meta for one startup — cheap once, and a rate-limit source under a
    // supervisor that health-checks on a schedule. Slack guards it with an in-flight promise.
    let resolveCheck: ((r: Response) => void) | undefined;
    const gated = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveCheck = resolve;
        }),
    ) as unknown as typeof fetch;
    const backend = makeBackend(gated);

    const [a, b] = [backend.connect(), backend.connect()];
    await new Promise((r) => setTimeout(r, 10));
    resolveCheck?.(
      new Response(JSON.stringify({ id: "PNID" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    expect([await a, await b]).toEqual([true, true]);
    expect(
      (gated as unknown as ReturnType<typeof vi.fn>).mock.calls,
      "two concurrent connects each asked Meta",
    ).toHaveLength(1);
  }, 30_000);

  it("lets a later connect retry after one failed", async () => {
    // The in-flight guard must not become a permanent one. A failed check leaves the backend
    // disconnected, and the next connect has to be able to actually try again — otherwise a
    // transient network blip at startup is indistinguishable from a revoked token forever.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempt = 0;
    const flaky = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("ENOTFOUND");
      return new Response(JSON.stringify({ id: "PNID" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const backend = makeBackend(flaky);

    expect(await backend.connect()).toBe(false);
    expect(await backend.connect()).toBe(true);
    expect(attempt).toBe(2);
    stderr.mockRestore();
  }, 30_000);
});

describe("WhatsAppCloudBackend — disconnect during an in-flight verify", () => {
  it("does not let a retired attempt mark the backend connected", async () => {
    // `verifyOnce()` wrote `connected = true` without asking whether its attempt was still the
    // current one. So: connect starts, disconnect runs and clears the flag, the verify then
    // resolves and sets it back — and every later connect short-circuits on a flag no live check
    // stands behind. The field's own comment says "cleared by disconnect()"; it was not.
    //
    // The assertion is on THIS backend, not a fresh one. A first version built a second object
    // and asserted against that — which connects trivially and proves nothing, the exact mistake
    // a sibling test made two rounds ago and the reason removing the guard left it green.
    let release: ((r: Response) => void) | undefined;
    let calls = 0;
    const gated = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return new Response(JSON.stringify({ id: "PNID" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const backend = makeBackend(gated);

    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    await backend.disconnect();
    release?.(
      new Response(JSON.stringify({ id: "PNID" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await connecting;

    // The consequence, not the flag: after an explicit disconnect the next connect must ask Meta
    // again. If the retired attempt was allowed to set `connected`, this short-circuits and the
    // call count stays at one.
    expect(await backend.connect()).toBe(true);
    expect(
      calls,
      "a retired verify marked the backend connected; the next connect never asked",
    ).toBe(2);

    // Deliberately NOT asserted here: that `send()` refuses on a disconnected backend. It does
    // not — the Cloud backend posts regardless, because Cloud is stateless HTTP and there is no
    // session to be outside of. Whether that should match Baileys, which does refuse, is a
    // separate question about the shared contract and not this test's business.
  }, 30_000);
});
