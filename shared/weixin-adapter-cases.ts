/**
 * The adapter cases the WeCom and WeChat packages share: the token endpoint, `sendMessage`, the
 * webhook flow and the runner round trip. A package's test file passes its own vitest and
 * `@theokit/gateway` functions in, because this file sits outside every package and resolves
 * neither; what differs (fixtures, endpoints, signing) stays in the package's file.
 */

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

export type FakeFetch = (
  url: string,
  init: { method: string; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** A fetch that records each call and answers with `answer(call)`, as JSON unless it is a string. */
export function fakeFetch(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch: FakeFetch = async (url, init) => {
    const call = { method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const out = answer(call);
    return { status: 200, text: async () => (typeof out === "string" ? out : JSON.stringify(out)) };
  };
  return { fetch, calls };
}

/** The answer of a healthy platform: a token from the token endpoint, `errcode` 0 elsewhere. */
export const okAnswer = (tokenPath: string) => (c: Call) =>
  c.url.includes(tokenPath)
    ? { access_token: "AT", expires_in: 7200 }
    : { errcode: 0, errmsg: "ok" };

interface Outbound {
  channel: { id: string; type: "dm" };
  text: string;
  format?: "markdown" | "plain" | "html";
}

interface WeixinAdapterUnderTest {
  connect(): Promise<boolean>;
  sendMessage(message: Outbound): Promise<{ ok: boolean }>;
  onInbound(
    handler: (event: { id: string; text?: string; channel: unknown }) => Promise<void>,
  ): void;
  handleWebhook(
    query: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; reason?: string; body?: string }>;
}

interface Runner {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface WeixinAdapterTools {
  readonly describe: (name: string, body: () => void) => void;
  readonly it: (name: string, body: () => unknown) => void;
  readonly afterEach: (body: () => unknown) => void;
  // biome-ignore lint/suspicious/noExplicitAny: vitest's `expect` is passed through untouched.
  readonly expect: ((value: unknown) => any) & { stringContaining(text: string): unknown };
  readonly GatewayRunner: new (options: never) => Runner;
}

export interface WeixinAdapterSpec {
  /** The adapter's class name, as it appears in the runner's `describe`. */
  readonly name: string;
  readonly make: (fetch: FakeFetch) => WeixinAdapterUnderTest;
  readonly parseXml: (xml: string) => Record<string, string>;
  /** A text message from `sender` with the text `hi 你好` and the id `123`. */
  readonly xml: string;
  readonly sender: string;
  /** A path fragment of the token endpoint, and the URL `connect` requests. */
  readonly tokenPath: string;
  readonly tokenUrl: string;
  readonly sendUrl: string;
  /** What `sendMessage` posts for `touser` and `content`. */
  readonly sendBody: (touser: string, content: string) => unknown;
  readonly sendFailedCode: string;
  readonly splitFor: (text: string) => string[];
  /** A request signed so it verifies, carrying `xml`. */
  readonly signed: (xml: string) => { query: Record<string, string>; body: string };
  /** `query` with a signature that does not verify. */
  readonly badSignature: (query: Record<string, string>) => Record<string, string>;
}

/** Registers the shared cases of one package; call it once at the top level of its test file. */
export function registerWeixinAdapterCases(tools: WeixinAdapterTools, spec: WeixinAdapterSpec) {
  const { describe, it, afterEach, expect, GatewayRunner } = tools;
  const { make, xml: XML } = spec;
  const ok = okAnswer(spec.tokenPath);

  describe("construction and xml", () => {
    it("parses CDATA and plain tags", () => {
      expect(spec.parseXml(XML)).toMatchObject({
        FromUserName: spec.sender,
        Content: "hi 你好",
        MsgId: "123",
      });
      expect(spec.parseXml("<xml><A>a &amp; b</A></xml>")).toEqual({ A: "a & b" });
    });
  });

  describe("connect", () => {
    it("is true when the token endpoint answers a token", async () => {
      const { fetch, calls } = fakeFetch(ok);
      expect(await make(fetch).connect()).toBe(true);
      expect(calls[0]?.url).toBe(spec.tokenUrl);
    });
    it("is false for a refused secret, a network failure and a non-JSON body", async () => {
      expect(
        await make(
          fakeFetch(() => ({ errcode: 40125, errmsg: "invalid appsecret" })).fetch,
        ).connect(),
      ).toBe(false);
      const boom: FakeFetch = async () => {
        throw new Error("down");
      };
      expect(await make(boom).connect()).toBe(false);
      expect(await make(fakeFetch(() => "<html>").fetch).connect()).toBe(false);
      expect(await make(fakeFetch(() => ({})).fetch).connect()).toBe(false);
    });
  });

  describe("sendMessage", () => {
    const out = { channel: { id: "o1", type: "dm" as const }, text: "yo" };
    it("posts to the message endpoint with the token", async () => {
      const { fetch, calls } = fakeFetch(ok);
      const a = make(fetch);
      await a.connect();
      expect(await a.sendMessage(out)).toEqual({ ok: true, messageId: "" });
      expect(calls[1]).toMatchObject({
        method: "POST",
        url: spec.sendUrl,
        body: spec.sendBody("o1", "yo"),
      });
    });
    it("splits long text in order and strips markdown", async () => {
      const { fetch, calls } = fakeFetch(ok);
      const a = make(fetch);
      await a.connect();
      await a.sendMessage({ ...out, text: "a".repeat(1300) });
      const sent = calls
        .slice(1)
        .map((c) => (c.body as { text: { content: string } }).text.content);
      expect(sent.map((s) => s.length)).toEqual([600, 600, 100]);
      expect(spec.splitFor("")).toEqual([]);
      await a.sendMessage({ ...out, text: "**b**", format: "markdown" });
      expect(calls.at(-1)?.body).toMatchObject({ text: { content: "b" } });
    });
    it("fetches a new token once the old one has expired", async () => {
      const { fetch, calls } = fakeFetch((c) =>
        c.url.includes(spec.tokenPath)
          ? { access_token: `AT${calls.length}`, expires_in: 1 }
          : { errcode: 0 },
      );
      const a = make(fetch);
      await a.connect();
      await a.sendMessage(out);
      expect(calls.filter((c) => c.url.includes(spec.tokenPath))).toHaveLength(2);
    });
    it("reports refusals without a throw", async () => {
      const a = make(fakeFetch(ok).fetch);
      expect((await a.sendMessage(out)).ok).toBe(false);
      await a.connect();
      expect(await a.sendMessage({ ...out, text: "" })).toMatchObject({
        error: { code: "empty_text" },
      });
      expect(await a.sendMessage({ ...out, channel: { id: "", type: "dm" } })).toMatchObject({
        error: { code: "invalid_channel" },
      });
      expect(
        await a.sendMessage({ ...out, attachments: [{ kind: "image", url: "u" }] } as never),
      ).toMatchObject({ error: { code: "attachments_unsupported" } });
      const refused = make(
        fakeFetch((c) =>
          c.url.includes(spec.tokenPath) ? ok(c) : { errcode: 45015, errmsg: "window" },
        ).fetch,
      );
      await refused.connect();
      expect(await refused.sendMessage(out)).toMatchObject({
        error: { code: spec.sendFailedCode, message: expect.stringContaining("45015") },
      });
    });
  });

  describe("handleWebhook", () => {
    it("dispatches a signed text message once", async () => {
      const a = make(fakeFetch(ok).fetch);
      const seen: unknown[] = [];
      a.onInbound(async (e) => void seen.push({ id: e.id, text: e.text, channel: e.channel }));
      const { query, body } = spec.signed(XML);
      expect((await a.handleWebhook(spec.badSignature(query), body)).status).toBe(401);
      expect(await a.handleWebhook(query, body)).toMatchObject({ status: 200, body: "success" });
      expect((await a.handleWebhook(query, body)).reason).toBe("duplicate");
      expect(seen).toEqual([
        { id: "123", text: "hi 你好", channel: { id: spec.sender, type: "dm" } },
      ]);
    });
    it("acknowledges other message types, answers 503 with no handler, contains a throw", async () => {
      const a = make(fakeFetch(ok).fetch);
      const other = spec.signed(XML.replace("<![CDATA[text]]>", "<![CDATA[event]]>"));
      expect((await a.handleWebhook(other.query, other.body)).status).toBe(200);
      const first = spec.signed(XML);
      expect((await a.handleWebhook(first.query, first.body)).status).toBe(503);
      a.onInbound(async () => {
        throw new Error("boom");
      });
      const second = spec.signed(XML);
      expect(await a.handleWebhook(second.query, second.body)).toMatchObject({
        status: 200,
        reason: "handler_threw",
      });
    });
  });

  describe(`GatewayRunner drives ${spec.name}`, () => {
    const running: Runner[] = [];
    afterEach(async () => {
      for (const r of running.splice(0)) await r.stop();
    });
    it("replies to a webhook message through ctx.reply", async () => {
      const { fetch, calls } = fakeFetch(ok);
      const adapter = make(fetch);
      let done: () => void = () => undefined;
      const handled = new Promise<void>((r) => (done = r));
      const runner = new GatewayRunner({
        adapters: [adapter],
        handler: async (_e: unknown, ctx: { reply(text: string): Promise<unknown> }) => {
          await ctx.reply("hello back");
          done();
        },
      } as never);
      running.push(runner);
      await runner.start();
      const { query, body } = spec.signed(XML);
      await adapter.handleWebhook(query, body);
      await handled;
      expect(calls.at(-1)?.body).toEqual(spec.sendBody(spec.sender, "hello back"));
    });
  });
}
