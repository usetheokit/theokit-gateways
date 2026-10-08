/**
 * Finding #22: `parseWebhookPayload` is the boundary for a Cloud webhook body. A body whose nested
 * levels have the wrong shape is refused there with `null`, the answer it already gives an
 * unrecognized top level, so neither normalizer can throw on a body that passed it.
 */

import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

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

  it("lets the Cloud backend answer a signed body with a null entry instead of rejecting", async () => {
    const backend = new WhatsAppCloudBackend({
      accessToken: "t",
      phoneNumberId: "PNID",
      appSecret: APP_SECRET,
      fetch: (async () => new Response("{}")) as typeof fetch,
    });
    const body = JSON.stringify(envelope([null]));
    const signature = `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;

    await expect(backend.handleWebhookPayload(body, signature)).resolves.toBe(true);
  });
});
