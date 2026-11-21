/**
 * The cases every signed-webhook channel descriptor owes: the route `createWebhookHandler` mounts,
 * and the env bindings `configFromEnv` reads. A package's test file passes its own vitest and
 * `@theokit/gateway` functions in, because this file sits outside every package and resolves
 * neither; what stays in the package's file is what differs from one platform to the next.
 */

type Config = Readonly<Record<string, unknown>>;
type Signed = { rawBody: string; headers: Record<string, string> };
type Rejection = { error: { code: string; message: string } };
type Created = { adapters: unknown[]; channels: unknown; rejected: Rejection[] };
type Inbound = { onInbound(handler: (event: { text?: string }) => Promise<void>): unknown };
type ErrorClass = new (...args: never[]) => Error & { code: string };

export interface WebhookChannelTools {
  readonly describe: (name: string, body: () => void) => void;
  readonly it: ((name: string, body: () => unknown) => void) & {
    each: (
      cases: ReadonlyArray<unknown>,
    ) => (name: string, body: (...args: never[]) => unknown) => void;
  };
  // biome-ignore lint/suspicious/noExplicitAny: vitest's `expect` is passed through untouched.
  readonly expect: (value: unknown) => any;
  readonly createChannels: (entries: never[]) => Created;
  readonly createWebhookHandler: (options: never) => (request: Request) => Promise<Response>;
  readonly configFromEnv: (
    descriptor: never,
    env: Record<string, string>,
    prefix: string,
  ) => { config: Config; missing: string[]; secrets: Iterable<string> };
}

export interface WebhookChannelSpec {
  readonly platform: string;
  readonly descriptor: { create(config: Config): unknown };
  readonly config: Config;
  /** A signed request carrying a text message whose text is `"hi"`. */
  readonly signedText: () => Signed;
  /** The headers of `signed` with a signature that does not verify. */
  readonly badSignature: (signed: Signed) => Record<string, string>;
  /** Every field and its variable, in declaration order. */
  readonly bindings: ReadonlyArray<readonly [key: string, env: string]>;
  readonly required: ReadonlyArray<string>;
  readonly secrets: ReadonlyArray<string>;
  readonly adapterClass: new (...args: never[]) => unknown;
  readonly errorClass: ErrorClass;
  /** Whether the route answers a GET with 405 (a channel with a `handle` of its own may not). */
  readonly refusesGet?: boolean;
}

const ENDPOINT = "https://example.test";

/** The `createWebhookHandler` route over one adapter of `spec`, and the texts it delivered. */
export function webhookRoute(t: WebhookChannelTools, spec: WebhookChannelSpec, subscribe = true) {
  const result = t.createChannels([
    { descriptor: spec.descriptor, config: spec.config },
  ] as never[]);
  const delivered: string[] = [];
  const adapter = result.adapters[0] as Inbound;
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e.text ?? ""));
  const handler = t.createWebhookHandler({
    channels: result.channels,
    isStarted: () => true,
  } as never);
  return { handler, delivered };
}

function webhookRouteCases(t: WebhookChannelTools, spec: WebhookChannelSpec): void {
  const url = `https://bot.test/webhooks/${spec.platform}`;
  const post = ({ rawBody, headers }: Signed) =>
    new Request(url, { method: "POST", body: rawBody, headers });

  t.describe(`${spec.platform} webhook through createWebhookHandler`, () => {
    t.it("delivers a signed event and answers 200", async () => {
      const { handler, delivered } = webhookRoute(t, spec);
      t.expect((await handler(post(spec.signedText()))).status).toBe(200);
      t.expect(delivered).toEqual(["hi"]);
    });

    t.it("answers 401 for a bad signature and delivers nothing", async () => {
      const { handler, delivered } = webhookRoute(t, spec);
      const signed = spec.signedText();
      const res = await handler(
        post({ rawBody: signed.rawBody, headers: spec.badSignature(signed) }),
      );
      t.expect(res.status).toBe(401);
      t.expect(delivered).toEqual([]);
    });

    t.it("answers 503 when no handler is subscribed", async () => {
      const { handler } = webhookRoute(t, spec, false);
      t.expect((await handler(post(spec.signedText()))).status).toBe(503);
    });

    if (spec.refusesGet) {
      t.it("refuses a method the route does not take", async () => {
        const { handler } = webhookRoute(t, spec);
        t.expect((await handler(new Request(url))).status).toBe(405);
      });
    }
  });
}

function envBindingCases(t: WebhookChannelTools, spec: WebhookChannelSpec): void {
  const descriptor = spec.descriptor as never;
  const envOf = (key: string) => `APP_${spec.bindings.find(([k]) => k === key)?.[1]}`;
  const env = Object.fromEntries(spec.required.map((key) => [envOf(key), `v-${key}`]));
  const optional = spec.bindings.map(([key]) => key).filter((key) => !spec.required.includes(key));
  const strings = Object.fromEntries(spec.required.map((key) => [key, "x"]));

  t.describe(`${spec.platform} channel env bindings`, () => {
    t.it("binds each field to its variable", () => {
      const fields = (spec.descriptor as unknown as { config: { key: string; env?: string }[] })
        .config;
      t.expect(fields.map((f) => [f.key, f.env])).toEqual(spec.bindings.map(([k, e]) => [k, e]));
    });

    t.it("builds the adapter from configFromEnv", () => {
      const { config, missing } = t.configFromEnv(descriptor, env, "APP_");
      t.expect(missing).toEqual([]);
      const result = t.createChannels([{ descriptor, config }] as never[]);
      t.expect(result.rejected).toEqual([]);
      t.expect(result.adapters[0]).toBeInstanceOf(spec.adapterClass);
    });

    t.it.each(spec.required.map((key) => [key, envOf(key)]))(
      "rejects with missing_required_config naming %s when %s is unset",
      (key: string, variable: string) => {
        const partial: Record<string, string> = { ...env };
        delete partial[variable];
        const { config, missing } = t.configFromEnv(descriptor, partial, "APP_");
        t.expect(missing).toEqual([variable]);
        const result = t.createChannels([{ descriptor, config, envPrefix: "APP_" }] as never[]);
        t.expect(result.adapters).toEqual([]);
        t.expect(result.rejected[0]?.error.code).toBe("missing_required_config");
        t.expect(result.rejected[0]?.error.message).toContain(key);
      },
    );

    t.it("collects only secret values", () => {
      const all = { ...env, ...Object.fromEntries(optional.map((key) => [envOf(key), ENDPOINT])) };
      const byName = (a: string, b: string) => a.localeCompare(b);
      const secrets = [...t.configFromEnv(descriptor, all, "APP_").secrets].sort(byName);
      t.expect(secrets).toEqual(spec.secrets.map((key) => `v-${key}`).sort(byName));
    });

    t.it("accepts optional string endpoints", () => {
      const endpoints = Object.fromEntries(optional.map((key) => [key, ENDPOINT]));
      t.expect(spec.descriptor.create({ ...strings, ...endpoints })).toBeInstanceOf(
        spec.adapterClass,
      );
    });

    t.it.each(spec.bindings.map(([key]) => key))(
      "throws invalid_config naming %s for a number",
      (key: string) => {
        let thrown: unknown;
        try {
          spec.descriptor.create({ ...strings, [key]: 5 });
        } catch (err) {
          thrown = err;
        }
        t.expect(thrown).toBeInstanceOf(spec.errorClass);
        t.expect((thrown as Error & { code: string }).code).toBe("invalid_config");
        t.expect((thrown as Error).message).toContain(key);
      },
    );
  });
}

/** Registers the route and env-binding cases of a signed-webhook channel descriptor. */
export function describeWebhookChannel(t: WebhookChannelTools, spec: WebhookChannelSpec): void {
  webhookRouteCases(t, spec);
  envBindingCases(t, spec);
}
