/**
 * An app translating a raw webhook payload — proved through each package's PUBLISHED entry point.
 *
 * This is what B-009 is about, and where it is asserted decides whether the assertion means
 * anything. Each import is by package name, so TypeScript resolves it through the manifest's
 * `types` field to `dist/index.d.ts` and Node resolves the value through `dist/index.js` — the
 * same surface an app installs. A test next to the source would import `src/` and stay green with
 * the export missing from the barrel, which is the one defect this arrangement exists to catch.
 *
 * `gateway-line` is here as the CONTROL, not because it changed: it already shipped this shape, and
 * it is what the other two were brought to. If its row ever fails, the reference moved.
 */

import { lineEventToMessageEvent } from "@theokit/gateway-line";
import { parseInbound as parseSMS } from "@theokit/gateway-sms";
import { parseInbound as parseTelegram } from "@theokit/gateway-telegram";
import { normalizeInboundMessages, parseWebhookPayload } from "@theokit/gateway-whatsapp";
import { describe, expect, it } from "vitest";

describe("an app can translate a raw payload without writing platform knowledge", () => {
  it("line — the reference shape, unchanged", () => {
    const event = lineEventToMessageEvent({
      type: "message",
      message: { type: "text", id: "msg-1", text: "olá" },
      source: { type: "user", userId: "U123" },
      timestamp: 1_700_000_000_000,
      replyToken: "rt-1",
      mode: "active",
    } as never);

    expect(event?.platform).toBe("line");
    expect(event?.text).toBe("olá");
  });

  it("telegram — a raw Update, no grammy Context", () => {
    const event = parseTelegram({
      update_id: 900_001,
      message: {
        message_id: 42,
        date: 1_700_000_000,
        text: "olá",
        chat: { id: -100_123, type: "supergroup" },
        from: { id: 777, username: "ada", first_name: "Ada" },
      },
    });

    expect(event?.platform).toBe("telegram");
    expect(event?.text).toBe("olá");
    expect(event?.receivedAt).toBe(1_700_000_000_000);
  });

  it("sms — a raw Twilio form body", () => {
    const event = parseSMS(
      {
        backend: "twilio",
        accountSid: "ACnotreal",
        authToken: "not-a-real-token",
        fromNumber: "+14155550123",
        publicUrl: "https://sms.invalid",
      },
      {
        headers: {},
        url: "https://sms.invalid/sms",
        rawBody: "From=%2B14155550199&To=%2B14155550123&Body=ol%C3%A1&MessageSid=SM123",
      },
    );

    expect(event?.platform).toBe("sms");
    expect(event?.text).toBe("olá");
  });

  it("whatsapp — a raw Meta envelope through the published chain", () => {
    const envelope = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "1555", phone_number_id: "PNID" },
                contacts: [{ profile: { name: "Ada" }, wa_id: "5535999" }],
                messages: [
                  {
                    from: "5535999",
                    id: "wamid.X",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "olá" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(envelope).not.toBeNull();
    const messages = normalizeInboundMessages(envelope as NonNullable<typeof envelope>);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("olá");
  });

  it("rejects a body no platform posted, without throwing", () => {
    // The contract the seam depends on: `onMessage` runs after TheoKit answered 200, so a throw
    // here escapes `handleChannelWebhook` entirely and the 200 is never built.
    expect(parseTelegram({ nonsense: true })).toBeNull();
    expect(parseWebhookPayload({ nonsense: true })).toBeNull();
  });
});
