import { GatewayConfigurationError, type MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { SignalAdapter, type SignalAdapterOptions } from "../src/index.js";
import { type FakeChild, fakeSpawn, until } from "./fake-child.js";

const ACCOUNT = "+5511999990000";
const NUMBER = "+5511888880000";
const UUID = "11111111-2222-3333-4444-555555555555";

async function firstEvent(
  opts: Partial<SignalAdapterOptions>,
  envelope: Record<string, unknown>,
): Promise<MessageEvent> {
  const fake = fakeSpawn();
  const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn, ...opts });
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  const connecting = adapter.connect();
  await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
  const child = fake.children[0] as FakeChild;
  child.answer((child.last("listGroups") as { id: number }).id, []);
  await connecting;
  child.receive({ timestamp: 1, dataMessage: { message: "hi" }, ...envelope });
  await until(() => events.length > 0, "event");
  return events[0] as MessageEvent;
}

describe("senderKey", () => {
  it("uses the number and keeps the uuid in signal", async () => {
    const event = await firstEvent(
      { senderKey: "number" },
      { sourceNumber: NUMBER, sourceUuid: UUID },
    );
    expect(event.sender.id).toBe(NUMBER);
    expect((event as { signal: { sourceUuid?: string } }).signal.sourceUuid).toBe(UUID);
    expect(event.channel.id).toBe(NUMBER);
  });

  it("falls back to the uuid when the number is hidden", async () => {
    const event = await firstEvent({ senderKey: "number" }, { sourceUuid: UUID });
    expect(event.sender.id).toBe(UUID);
  });

  it("keeps the uuid by default", async () => {
    const event = await firstEvent({}, { sourceNumber: NUMBER, sourceUuid: UUID });
    expect(event.sender.id).toBe(UUID);
  });

  it("rejects any other value", () => {
    let thrown: unknown;
    try {
      new SignalAdapter({ account: "+1555", senderKey: "email" as never });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("senderKey");
  });
});
