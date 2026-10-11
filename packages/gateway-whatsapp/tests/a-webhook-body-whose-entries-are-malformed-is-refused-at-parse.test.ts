/**
 * Finding #22: `parseWebhookPayload` is the boundary for a Cloud webhook body. A body whose nested
 * levels have the wrong shape is refused there with `null`, the answer it already gives an
 * unrecognized top level, so neither normalizer can throw on a body that passed it.
 */

import * as crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsAppCloudBackend } from "../src/backend/cloud/index.js";
import {
  normalizeInboundMessages,
  normalizeStatusReceipts,
  parseWebhookPayload,
} from "../src/backend/cloud/webhook.js";

const APP_SECRET = "test-secret";

function envelope(entry: unknown): unknown {
  return { object: "whatsapp_business_account", entry };
}

function change(value: unknown): unknown {
  return { id: "biz-1", changes: [{ field: "messages", value }] };
}

const VALUE = {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "5511", phone_number_id: "PNID" },
};

function textMessage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    from: "5511888",
    id: "wamid.t",
    timestamp: "1700000000",
    type: "text",
    text: { body: "hi" },
    ...overrides,
  };
}

describe("a webhook body whose nested levels have the wrong shape", () => {
  it.each([
    ["a null entry", envelope([null])],
    ["an entry that is a string", envelope(["entry"])],
    ["an entry with no changes", envelope([{ id: "biz-1" }])],
    ["an entry whose changes is not an array", envelope([{ id: "biz-1", changes: { 0: {} } }])],
    ["a null change", envelope([{ id: "biz-1", changes: [null] }])],
    ["a change value that is a number", envelope([change(5)])],
    ["messages that is not an array", envelope([change({ ...VALUE, messages: 5 })])],
    ["a null message", envelope([change({ ...VALUE, messages: [null] })])],
    ["statuses that is not an array", envelope([change({ ...VALUE, statuses: "x" })])],
    ["a null status", envelope([change({ ...VALUE, statuses: [null] })])],
    ["contacts that is not an array", envelope([change({ ...VALUE, contacts: 1 })])],
    ["a null contact", envelope([change({ ...VALUE, contacts: [null] })])],
  ])("parses %s as null", (_, body) => {
    expect(parseWebhookPayload(body)).toBeNull();
  });

  // Code-review finding #16: the rules downstream call string methods on these fields, so a
  // well-shaped envelope with a number or null in one of them threw TypeError past the boundary.
  it.each([
    ["a numeric phone_number_id", { ...VALUE, metadata: { phone_number_id: 999123 } }],
    ["a null phone_number_id", { ...VALUE, metadata: { phone_number_id: null } }],
    ["metadata that is a string", { ...VALUE, metadata: "PNID" }],
    [
      "a text message whose from is a number",
      { ...VALUE, messages: [textMessage({ from: 5511 })] },
    ],
    ["a text message whose id is a number", { ...VALUE, messages: [textMessage({ id: 7 })] }],
    [
      "a text message whose body is a number",
      { ...VALUE, messages: [textMessage({ text: { body: 42 } })] },
    ],
    [
      "a text message whose text is a string",
      { ...VALUE, messages: [textMessage({ text: "hi" })] },
    ],
  ])("parses %s as null", (_, value) => {
    expect(parseWebhookPayload(envelope([change(value)]))).toBeNull();
  });

  // Code-review finding #19: the normalizers copy these fields into fields typed as strings, so a
  // contact name of 42 became `sender.displayName` 42 and a status id of 5 became a receipt's wamid.
  it.each([
    [
      "a contact whose name is a number",
      { ...VALUE, contacts: [{ wa_id: "5511888", profile: { name: 42 } }] },
    ],
    [
      "a contact whose profile is a string",
      { ...VALUE, contacts: [{ wa_id: "5511888", profile: "Ana" }] },
    ],
    ["a contact whose wa_id is a number", { ...VALUE, contacts: [{ wa_id: 5511888 }] }],
    [
      "a status whose id is a number",
      { ...VALUE, statuses: [{ id: 7, status: "read", recipient_id: "5511", timestamp: "1" }] },
    ],
    [
      "a status whose status is an object",
      { ...VALUE, statuses: [{ id: "w", status: {}, recipient_id: "5511", timestamp: "1" }] },
    ],
    [
      "a status whose recipient_id is null",
      { ...VALUE, statuses: [{ id: "w", status: "read", recipient_id: null, timestamp: "1" }] },
    ],
  ])("parses %s as null", (_, value) => {
    expect(parseWebhookPayload(envelope([change(value)]))).toBeNull();
  });

  it("still parses a contact with no profile, and names no sender for it", () => {
    const env = parseWebhookPayload(
      envelope([
        change({ ...VALUE, contacts: [{ wa_id: "5511888" }], messages: [textMessage({})] }),
      ]),
    );

    expect(env).not.toBeNull();
    expect(normalizeInboundMessages(env!).map((e) => e.contactName)).toEqual([undefined]);
  });

  it("still parses a value with no metadata and a text message with no text", () => {
    const env = parseWebhookPayload(
      envelope([
        change({ messaging_product: "whatsapp", messages: [textMessage({ text: undefined })] }),
      ]),
    );

    expect(env).not.toBeNull();
    expect(normalizeInboundMessages(env!).map((e) => [e.wamid, e.text])).toEqual([["wamid.t", ""]]);
  });

  it("still parses and normalizes a valid envelope with a message and a status", () => {
    const env = parseWebhookPayload(
      envelope([
        change({
          ...VALUE,
          contacts: [{ wa_id: "5511888", profile: { name: "Ana" } }],
          messages: [
            {
              from: "5511888",
              id: "wamid.m",
              timestamp: "1700000000",
              type: "text",
              text: { body: "hi" },
            },
          ],
          statuses: [
            { id: "wamid.s", status: "read", recipient_id: "5511888", timestamp: "1700000001" },
          ],
        }),
      ]),
    );

    expect(env).not.toBeNull();
    expect(normalizeInboundMessages(env!).map((e) => [e.wamid, e.contactName, e.text])).toEqual([
      ["wamid.m", "Ana", "hi"],
    ]);
    expect(normalizeStatusReceipts(env!).map((r) => [r.wamid, r.phoneNumberId])).toEqual([
      ["wamid.s", "PNID"],
    ]);
  });

  it("still parses an entry with an empty changes array and a change with no value", () => {
    const env = parseWebhookPayload(
      envelope([
        { id: "a", changes: [] },
        { id: "b", changes: [{ field: "x" }] },
      ]),
    );

    expect(env).not.toBeNull();
    expect([normalizeInboundMessages(env!), normalizeStatusReceipts(env!)]).toEqual([[], []]);
  });
});

/**
 * Code-review finding #14: the property above, that nothing in a batch is dropped without the
 * route seeing it, has to hold on `WhatsAppCloudBackend.handleWebhookPayload` too. It answered such
 * a body `true`, the answer a dispatched batch gets, so a route built on it answered 200, Meta did
 * not redeliver, and every message of the batch was lost with nothing logged. It now answers
 * `false`, as it does for a signed body that is not JSON, and writes one line to stderr.
 */
describe("the Cloud backend given a signed body it cannot read", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function backendWithHandler(): { backend: WhatsAppCloudBackend; received: string[] } {
    const backend = new WhatsAppCloudBackend({
      accessToken: "t",
      phoneNumberId: "PNID",
      appSecret: APP_SECRET,
      fetch: (async () => new Response("{}")) as typeof fetch,
    });
    const received: string[] = [];
    backend.onInbound(async (event) => {
      received.push(event.wamid);
    });
    return { backend, received };
  }

  function signed(body: string): string {
    return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
  }

  it("answers false and writes one stderr line for a null entry, instead of rejecting", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend } = backendWithHandler();
    const body = JSON.stringify(envelope([null]));

    await expect(backend.handleWebhookPayload(body, signed(body))).resolves.toBe(false);
    expect(stderr.mock.calls.map(([line]) => String(line))).toEqual([
      expect.stringContaining("[whatsapp-cloud] signed webhook body has a shape"),
    ]);
  });

  it("answers false for a numeric phone_number_id, instead of rejecting with a TypeError", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend, received } = backendWithHandler();
    const body = JSON.stringify(
      envelope([
        change({ ...VALUE, metadata: { phone_number_id: 999123 }, messages: [textMessage({})] }),
      ]),
    );

    await expect(backend.handleWebhookPayload(body, signed(body))).resolves.toBe(false);
    expect(received).toEqual([]);
  });

  it("answers false for a body whose contact name is a number, delivering nothing", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend, received } = backendWithHandler();
    const body = JSON.stringify(
      envelope([
        change({
          ...VALUE,
          contacts: [{ wa_id: "5511888", profile: { name: 42 } }],
          messages: [textMessage({})],
        }),
      ]),
    );

    await expect(backend.handleWebhookPayload(body, signed(body))).resolves.toBe(false);
    expect(received).toEqual([]);
  });

  it("answers false for a batch whose good message sits beside a malformed entry, delivering none", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend, received } = backendWithHandler();
    const good = change({
      ...VALUE,
      messages: [
        { from: "5511999", id: "wamid.good", timestamp: "1", type: "text", text: { body: "hi" } },
      ],
    });
    const body = JSON.stringify(envelope([good, { id: "biz-2" }]));

    await expect(backend.handleWebhookPayload(body, signed(body))).resolves.toBe(false);
    expect(received).toEqual([]);
  });
});
