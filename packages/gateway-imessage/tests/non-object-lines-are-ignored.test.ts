import { describe, expect, it } from "vitest";

import { IMessageAdapter } from "../src/index.js";
import { type FakeChild, fakeSpawn, until } from "./fake-child.js";

describe("IMessageAdapter with stdout lines that are not objects", () => {
  it("skips null, a number, a string and an array, and still settles later requests", async () => {
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const connecting = adapter.connect();
    await until(() => fake.children.at(-1)?.last("watch.subscribe") !== undefined, "subscribe");
    const child = fake.children.at(-1) as FakeChild;
    for (const line of ["null", "42", '"x"', "[]"]) child.emitLine(line);
    child.answer((child.last("watch.subscribe") as { id: number }).id, { subscription: 1 });
    expect(await connecting).toBe(true);

    const sending = adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "hi" });
    await until(() => child.last("send") !== undefined, "send");
    for (const line of ["null", "42", '"x"', "[]"]) child.emitLine(line);
    child.answer((child.last("send") as { id: number }).id, { ok: true });

    expect((await sending).ok).toBe(true);
  });
});
