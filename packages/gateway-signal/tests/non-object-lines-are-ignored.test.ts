import { describe, expect, it } from "vitest";

import { SignalAdapter } from "../src/index.js";
import { type FakeChild, fakeSpawn, until } from "./fake-child.js";

describe("SignalAdapter with stdout lines that are not objects", () => {
  it("skips null, a number, a string and an array, and still settles later requests", async () => {
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: "+5511999990000", spawn: fake.spawn });
    const connecting = adapter.connect();
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
    const child = fake.children[0] as FakeChild;
    for (const line of ["null", "42", '"x"', "[]"]) child.emitLine(line);
    child.answer((child.last("listGroups") as { id: number }).id, []);
    expect(await connecting).toBe(true);

    const sending = adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "hi" });
    await until(() => child.last("send") !== undefined, "send");
    for (const line of ["null", "42", '"x"', "[]"]) child.emitLine(line);
    child.answer((child.last("send") as { id: number }).id, { timestamp: 5 });

    await expect(sending).resolves.toEqual({ ok: true, messageId: "5" });
  });
});
