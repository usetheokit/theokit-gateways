import { describe, expect, it } from "vitest";

import { SignalAdapter } from "../src/index.js";
import { fakeSpawn, until } from "./fake-child.js";

describe("SignalAdapter connect after disconnect", () => {
  it("a connect after a disconnect during a pending connect starts a fresh signal-cli", async () => {
    const fake = fakeSpawn();
    const adapter = new SignalAdapter({ account: "+5511999990000", spawn: fake.spawn });

    const first = adapter.connect();
    await until(() => fake.children[0]?.last("listGroups") !== undefined, "first listGroups");
    await adapter.disconnect();
    const second = adapter.connect();
    await until(() => fake.children[1]?.last("listGroups") !== undefined, "second listGroups");
    const child = fake.children[1]!;
    child.answer(child.last("listGroups")!.id, []);

    await expect(second).resolves.toBe(true);
    await expect(first).resolves.toBe(false);
    expect(fake.children).toHaveLength(2);
    await adapter.disconnect();
  });
});
