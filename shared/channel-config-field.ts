/**
 * One configuration field, shaped like the core's `ChannelConfigField` (typed locally so a published
 * `.d.ts` never names a core type an older peer release lacks), and its constructor.
 */
export interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env?: string;
}

export const field = (
  key: string,
  env: string,
  description: string,
  { required = true, secret = false }: { required?: boolean; secret?: boolean } = {},
): ConfigField => ({ key, required, secret, env, description });
