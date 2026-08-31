/**
 * Test helper — minimal in-memory adapter for runner/hook tests.
 * Not exported from the package; lives in tests/ only.
 */

import {
  BasePlatformAdapter,
  type OutboundMessage,
  type SendResult,
} from "../../src/adapter/base.js";
import type { MessageEvent, PlatformName } from "../../src/types/message-event.js";

export class MockAdapter extends BasePlatformAdapter {
  readonly platform: PlatformName;
  connected = false;
  connectCount = 0;
  disconnectCount = 0;
  sent: OutboundMessage[] = [];
  /** Every call, including the ones `sendMessage` refuses — `sent` only records what it accepted. */
  sendAttempts = 0;
  /** Force sendMessage to return error on next call. */
  failNextSend?: { code: string; message: string };
  /** What `connect()` reports. `false` is a refusal, not a throw — the D172 contract. */
  connectResult = true;
  private handler?: (event: MessageEvent) => Promise<void>;

  constructor(platform: PlatformName = "telegram") {
    super();
    this.platform = platform;
  }

  override async connect(): Promise<boolean> {
    this.connectCount += 1;
    this.connected = this.connectResult;
    return this.connectResult;
  }

  override async disconnect(): Promise<void> {
    this.disconnectCount += 1;
    this.connected = false;
  }

  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    this.sendAttempts += 1;
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "text is empty" } };
    }
    if (this.failNextSend !== undefined) {
      const err = this.failNextSend;
      this.failNextSend = undefined;
      return { ok: false, error: err };
    }
    this.sent.push(out);
    return { ok: true, messageId: `mock-${this.sent.length}` };
  }

  override onInbound(handler: (event: MessageEvent) => Promise<void>): () => void {
    // EC-H: replace previous handler.
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  /** Test helper: simulate an inbound event. */
  async emit(event: MessageEvent): Promise<void> {
    if (this.handler !== undefined) await this.handler(event);
  }

  /** The out-of-band ingest every adapter carries (#83). */
  override async deliver(event: MessageEvent): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }
}
