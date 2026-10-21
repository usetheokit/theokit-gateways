/**
 * Edit contract — what `BasePlatformAdapter.editMessage` and `supportsEdit` promise.
 *
 * The base answers for every adapter that cannot edit: `supportsEdit` is `false` and an edit is
 * refused as `edit_unsupported` naming the platform, with no platform call and no throw. A caller
 * reads the flag before it starts a preview and treats the refusal as "send instead".
 *
 * The probe below declares neither member, so every assertion reads the base default and not a
 * value the probe supplied.
 *
 * @internal
 */

import { describe, expect, it, vi } from "vitest";
import {
  BasePlatformAdapter,
  type OutboundMessage,
  type SendResult,
} from "../../src/adapter/base.js";
import type { MessageEvent } from "../../src/types/message-event.js";

/** A stand-in for the platform SDK a real adapter holds. The base default never reaches it. */
interface FakePlatformClient {
  send(text: string): Promise<void>;
  edit(id: string, text: string): Promise<void>;
}

class NonEditProbe extends BasePlatformAdapter {
  override readonly platform = "sms" as const;
  readonly client: FakePlatformClient = {
    send: vi.fn(async () => undefined),
    edit: vi.fn(async () => undefined),
  };

  override async connect(): Promise<boolean> {
    return true;
  }

  override async disconnect(): Promise<void> {
    /* nothing to close */
  }

  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    await this.client.send(out.text);
    return { ok: true, messageId: "sent-1" };
  }

  override onInbound(_handler: (event: MessageEvent) => Promise<void>): () => void {
    return () => undefined;
  }

  override async deliver(_event: MessageEvent): Promise<"ok" | "no_handler" | "handler_threw"> {
    return "no_handler";
  }
}

const OUT: OutboundMessage = { channel: { id: "c", type: "dm" }, text: "hi" };

const UNSUPPORTED: SendResult = {
  ok: false,
  error: { code: "edit_unsupported", message: "sms adapter cannot edit a sent message" },
};

describe("BasePlatformAdapter edit default", () => {
  it("reports supportsEdit as false on an adapter that does not override it", () => {
    expect(new NonEditProbe().supportsEdit).toBe(false);
  });

  it("refuses an edit as edit_unsupported naming the platform", async () => {
    expect(await new NonEditProbe().editMessage("42", OUT)).toEqual(UNSUPPORTED);
  });

  it("makes no platform call when it refuses an edit", async () => {
    const probe = new NonEditProbe();
    const send = vi.spyOn(probe, "sendMessage");

    await probe.editMessage("42", OUT);

    expect(send).toHaveBeenCalledTimes(0);
    // The base cannot reach `client`, so these two hold by construction. They stay as the plan's
    // record that no SDK call is made; the `sendMessage` spy above is the assertion that can fail.
    expect(probe.client.send).toHaveBeenCalledTimes(0);
    expect(probe.client.edit).toHaveBeenCalledTimes(0);
  });

  it("answers capability before input, even with empty text and an empty id", async () => {
    const empty: OutboundMessage = { channel: { id: "", type: "dm" }, text: "" };
    await expect(new NonEditProbe().editMessage("", empty)).resolves.toEqual(UNSUPPORTED);
  });
});
