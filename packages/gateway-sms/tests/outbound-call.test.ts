import { describe, expect, it } from "vitest";

import { placeCall } from "../src/outbound-call.js";

const base = {
  to: "+15551230000",
  from: "+15559990000",
  url: "https://x.test/voice",
  credentials: { accountSid: "ACabc", authToken: "tok" },
};

describe("placeCall", () => {
  it("sends one authenticated request and returns the sid", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fake = (async (u: string, init: RequestInit) => {
      calls.push([u, init]);
      return new Response(JSON.stringify({ sid: "CA123" }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await placeCall({ ...base, fetch: fake })).toBe("CA123");
    expect(calls).toHaveLength(1);
    const [u, init] = calls[0] as [string, RequestInit];
    expect(u).toBe("https://api.twilio.com/2010-04-01/Accounts/ACabc/Calls.json");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("ACabc:tok").toString("base64")}`,
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe(base.to);
    expect(body.get("From")).toBe(base.from);
    expect(body.get("Url")).toBe(base.url);
  });
  it("throws on a failed status and on a missing sid", async () => {
    const bad = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    await expect(placeCall({ ...base, fetch: bad })).rejects.toThrow("401");
    const empty = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(placeCall({ ...base, fetch: empty })).rejects.toThrow("no sid");
  });
});
