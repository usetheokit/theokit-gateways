import { describe, expect, it } from "vitest";
import { WeixinAdapterBase, type WeixinFetch } from "../../src/adapter/weixin-base.js";

class Probe extends WeixinAdapterBase {
  readonly platform = "wechat" as const;
  sendMessage() {
    return Promise.resolve({ ok: true as const, messageId: "" });
  }
  constructor(fetch: WeixinFetch) {
    super({
      label: "probe",
      className: "Probe",
      brand: "Probe",
      userNoun: "an id",
      defaultBase: "https://x.test",
      fetch,
    });
  }
  protected tokenPath() {
    return "/token";
  }
  protected sendRequest() {
    return { path: "/send", payload: {} };
  }
  protected split(t: string) {
    return [t];
  }
  protected toEvent() {
    return "skip" as const;
  }
  getToken(force: boolean) {
    return (this as unknown as { token(f: boolean): Promise<string> }).token(force);
  }
}

const reply = (body: unknown) => async () => ({
  status: 200,
  text: async () => JSON.stringify(body),
});

describe("WeixinAdapterBase token", () => {
  it("shares one request between concurrent callers", async () => {
    let calls = 0;
    const a = new Probe(async () => {
      calls += 1;
      return { status: 200, text: async () => '{"access_token":"t","expires_in":7200}' };
    });
    expect(await Promise.all([a.getToken(false), a.getToken(false)])).toEqual(["t", "t"]);
    expect(calls).toBe(1);
  });

  it("keeps the error messages", async () => {
    await expect(
      new Probe(reply({ errcode: 40013, errmsg: "bad" })).getToken(false),
    ).rejects.toThrow("token answered error 40013: bad");
    await expect(new Probe(reply({})).getToken(false)).rejects.toThrow(
      "token answer has no access_token",
    );
  });

  it("refetches after disconnect", async () => {
    let calls = 0;
    const a = new Probe(async () => {
      calls += 1;
      return { status: 200, text: async () => '{"access_token":"t"}' };
    });
    await a.getToken(false);
    await a.disconnect();
    await a.getToken(false);
    expect(calls).toBe(2);
  });
});
