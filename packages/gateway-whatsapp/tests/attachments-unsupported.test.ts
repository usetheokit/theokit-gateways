/**
 * `WhatsAppAdapter` refuses an outbound that carries attachments (B-674, AC-005).
 *
 * WhatsApp is tested here rather than in the integration conformance suite: its adapter takes a
 * backend, so a fake backend counts every send the refusal must not make.
 */

import { describe, expect, it } from "vitest";

import { WhatsAppAdapter } from "../src/adapter.js";
import type {
  WhatsAppBackend,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
} from "../src/backend-types.js";

class CountingBackend implements WhatsAppBackend {
  readonly kind = "cloud" as const;
  readonly sends: WhatsAppOutboundMessage[] = [];

  async connect(): Promise<boolean> {
    return true;
  }
  async disconnect(): Promise<void> {
    /* nothing to close */
  }
  async send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    this.sends.push(message);
    return { ok: true, wamid: `wamid.${this.sends.length}` };
  }
  onInbound(): () => void {
    return () => undefined;
  }
  onStatusReceipt(): () => void {
    return () => undefined;
  }
}

describe("WhatsAppAdapter attachments", () => {
  it("refuses an outbound with an image with 0 backend sends", async () => {
    const backend = new CountingBackend();
    const adapter = new WhatsAppAdapter(backend);
    await adapter.connect();

    const result = await adapter.sendMessage({
      channel: { id: "5511888888888", type: "dm" },
      text: "here it is",
      attachments: [{ kind: "image", mediaType: "image/png", data: new Uint8Array([1]) }],
    });

    expect(adapter.supportsAttachments).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("attachments_unsupported");
    expect(backend.sends).toHaveLength(0);
  });

  it("still sends an outbound with no attachments", async () => {
    const backend = new CountingBackend();
    const adapter = new WhatsAppAdapter(backend);
    await adapter.connect();

    const result = await adapter.sendMessage({
      channel: { id: "5511888888888", type: "dm" },
      text: "hi",
      attachments: [],
    });

    expect(result).toEqual({ ok: true, messageId: "wamid.1" });
    expect(backend.sends).toHaveLength(1);
  });
});
