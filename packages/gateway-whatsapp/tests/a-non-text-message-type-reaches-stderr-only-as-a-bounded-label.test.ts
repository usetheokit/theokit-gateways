/**
 * The stderr line a non-text Cloud message writes (code review findings #23 and #34, B-421).
 *
 * `msg.type` comes from the webhook envelope, and `toDeliverableEvents` does not verify the
 * signature, so a route that skips verification hands the normalizer a type anyone wrote. The line
 * names only a label from a fixed set of Meta message types, and the once-only set is keyed by that
 * label, so neither the log nor the set carries attacker text or grows with it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MetaWebhookEnvelope } from "../src/backend/cloud/types.js";
import { __resetNonTextWarnings, normalizeInboundMessages } from "../src/backend/cloud/webhook.js";

let stderrWrites: string[] = [];

beforeEach(() => {
  __resetNonTextWarnings();
  stderrWrites = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrWrites.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetNonTextWarnings();
});

function envelopeWithTypes(types: readonly string[]): MetaWebhookEnvelope {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: "PNID" },
              messages: types.map((type, i) => ({
                from: "5511999999999",
                id: `wamid.${i}`,
                timestamp: "1700000000",
                type,
              })),
            },
          },
        ],
      },
    ],
  } as MetaWebhookEnvelope;
}

describe("the stderr line for a non-text message type", () => {
  it("writes one line with no embedded newline and no attacker text for a forged type", () => {
    normalizeInboundMessages(envelopeWithTypes(["t\nFORGED"]));

    expect(stderrWrites).toHaveLength(1);
    const line = stderrWrites[0] ?? "";
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(line).not.toContain("FORGED");
    expect(line).toContain("an unknown type");
  });

  it("writes one line for many distinct unknown types, because they share one label", () => {
    const types = Array.from({ length: 50 }, (_, i) => `forged-${i}`);

    normalizeInboundMessages(envelopeWithTypes(types));

    expect(stderrWrites).toHaveLength(1);
    expect(stderrWrites[0]).toContain("an unknown type");
    expect(stderrWrites.join("")).not.toContain("forged-");
  });

  it("still names a known non-text type, once", () => {
    normalizeInboundMessages(envelopeWithTypes(["image", "image", "audio"]));

    expect(stderrWrites).toHaveLength(2);
    expect(stderrWrites[0]).toContain("ignoring image message");
    expect(stderrWrites[1]).toContain("ignoring audio message");
  });
});
