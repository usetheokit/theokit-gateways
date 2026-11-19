/**
 * The contract every package descriptor (`xChannel`, `wechatChannel`, …) must meet, written once.
 *
 * The caller injects `vitest` and `@theokit/gateway` because this file lives outside any package and
 * so cannot resolve them itself.
 */

interface Field {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly env?: string;
}

interface Rejection {
  readonly error: { readonly code: string; readonly message: string };
}

// biome-ignore lint/suspicious/noExplicitAny: the injected vitest and gateway values are typed by the caller's own imports.
type Loose = any;

export interface ContractOptions {
  readonly name: string;
  readonly channel: {
    readonly config: ReadonlyArray<Field>;
    create(config: Record<string, unknown>): unknown;
  };
  readonly adapterClass: new (...args: never[]) => unknown;
  /** Every variable (prefixed `APP_`) needed to build, plus optional ones. */
  readonly env: Record<string, string>;
  /** The same configuration as `create` receives it, keyed by option. */
  readonly values: Record<string, unknown>;
  readonly vitest: { describe: Loose; expect: Loose; it: Loose };
  readonly gateway: {
    configFromEnv: Loose;
    createChannels: Loose;
    GatewayConfigurationError: new (...args: never[]) => Error;
  };
}

/** Registers the shared tests; returns `refusal` so a package can add its own cases. */
export function describeChannelContract(o: ContractOptions): {
  refusal: (config: Record<string, unknown>) => { code: string; message: string };
} {
  const { describe, expect, it } = o.vitest;
  const { configFromEnv, createChannels, GatewayConfigurationError } = o.gateway;
  const descriptor = o.channel;
  const refusal = (config: Record<string, unknown>) => {
    try {
      o.channel.create(config);
    } catch (err) {
      return err as { code: string; message: string };
    }
    throw new Error("create did not throw");
  };
  const required = o.channel.config.filter((f) => f.required);
  const secretValues = o.channel.config
    .filter((f) => f.secret)
    .map((f) => o.values[f.key] as string)
    .sort();
  const run = (source: Record<string, string>) => {
    const env = configFromEnv(descriptor, source, "APP_");
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    return { env, result: result as { adapters: unknown[]; rejected: Rejection[] } };
  };

  describe(o.name, () => {
    it("builds the adapter through createChannels from configFromEnv", () => {
      const { env, result } = run(o.env);
      expect(env.missing).toEqual([]);
      expect(result.rejected).toEqual([]);
      expect(result.adapters[0]).toBeInstanceOf(o.adapterClass);
    });

    it.each(required.map((f) => [`APP_${f.env}`]))(
      "a missing %s is rejected naming the full variable",
      (name: string) => {
        const source = { ...o.env };
        delete source[name];
        const { env, result } = run(source);
        expect(env.missing).toEqual([name]);
        expect(result.rejected[0]?.error.code).toBe("missing_required_config");
        expect(result.rejected[0]?.error.message).toContain(name);
      },
    );

    it("lists exactly the secret values in configFromEnv(...).secrets", () => {
      expect([...configFromEnv(descriptor, o.env, "APP_").secrets].sort()).toEqual(secretValues);
    });

    it.each(required.map((f) => [f.key]))(
      "refuses a wrongly typed %s with invalid_config",
      (key: string) => {
        const error = refusal({ ...o.values, [key]: { not: "valid" } });
        expect(error).toBeInstanceOf(GatewayConfigurationError);
        expect(error.code).toBe("invalid_config");
        expect(error.message).toContain(key);
      },
    );
  });
  return { refusal };
}
