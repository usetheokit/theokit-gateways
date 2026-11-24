import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../src/errors.js";
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

  it("posts inline Twiml and no Url", async () => {
    let init: RequestInit | undefined;
    const fake = (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response(JSON.stringify({ sid: "CA1" }), { status: 201 });
    }) as unknown as typeof fetch;
    const { url: _url, ...rest } = base;
    await placeCall({ ...rest, twiml: "<Response><Say>hi</Say></Response>", fetch: fake });
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("Twiml")).toBe("<Response><Say>hi</Say></Response>");
    expect(body.has("Url")).toBe(false);
    expect(init?.redirect).toBe("error");
  });
  it("rejects both or neither of url and twiml before any request", async () => {
    let n = 0;
    const fake = (async () => {
      n++;
      return new Response("{}");
    }) as unknown as typeof fetch;
    await expect(placeCall({ ...base, twiml: "<Response/>", fetch: fake })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    const { url: _url, ...rest } = base;
    await expect(placeCall({ ...rest, fetch: fake })).rejects.toBeInstanceOf(ConfigurationError);
    expect(n).toBe(0);
  });
  it("rejects after timeoutMs when fetch never resolves", async () => {
    const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
    await expect(placeCall({ ...base, fetch: hang, timeoutMs: 20 })).rejects.toThrow("timed out");
  });
  it("reports Twilio's message and status without the auth token", async () => {
    const bad = (async () =>
      new Response(JSON.stringify({ message: "x bad tok" }), {
        status: 400,
      })) as unknown as typeof fetch;
    const err = await placeCall({ ...base, fetch: bad }).catch((e: Error) => e);
    expect((err as Error).message).toContain("x");
    expect((err as Error).message).toContain("400");
    expect((err as Error).message).not.toContain("tok");
  });
});
