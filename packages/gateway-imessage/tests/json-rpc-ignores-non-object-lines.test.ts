import { describe, expect, it } from "vitest";

import { JsonRpcLineClient } from "../src/json-rpc.js";
import { FakeChild, until } from "./fake-child.js";

describe("JsonRpcLineClient with stdout lines that are not objects", () => {
  it("skips null, a number, a string and an array, and still settles a later response", async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(
      child,
      "gateway-imessage",
      () => {},
      () => {},
    );
    const pending = client.request("chats.list", {}, 5_000);
    await until(() => child.written.length === 1, "request written");

    for (const line of ["null", "42", '"x"', "[]"]) child.emitLine(line);
    child.answer(child.written[0]?.id as number, { ok: true });

    expect(await pending).toEqual({ kind: "result", result: { ok: true } });
    const next = client.request("chats.list", {}, 5_000);
    await until(() => child.written.length === 2, "second request written");
    child.answer(child.written[1]?.id as number, 1);
    expect(await next).toEqual({ kind: "result", result: 1 });
  });
});
