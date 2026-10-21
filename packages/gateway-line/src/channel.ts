/**
 * `lineChannel` — the LINE channel described as data (FR-005 of B-018).
 *
 * Typed locally on purpose (ADR D4 of B-018): this package declares `@theokit/gateway >=0.9.0` as
 * its peer, and a published `.d.ts` naming a core type that 0.9.0 lacks would break a consumer on
 * that floor with no gate here to catch it. The object is structurally a `ChannelDescriptor`; the
 * integration package assigns it to one, and its typecheck is where a drift between the two fails.
 */

import { LineAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";
import { verifyLineSignature } from "./signature.js";
import type { LineAdapterOptions, LineWebhookEnvelope } from "./types.js";

const SIGNATURE_HEADER = "x-line-signature";

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-line: config.${key} must be ${expected}`,
    detail: key,
  });
}

/** A required string; an empty one is left for the adapter's own check, which names it. */
function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

/** An optional value: `undefined`, `null` and `""` are absent, anything else must pass `check`. */
function optional<T>(
  config: Readonly<Record<string, unknown>>,
  key: string,
  check: (value: unknown) => value is T,
  expected: string,
): T | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (!check(value)) throw invalid(key, expected);
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

function buildOptions(config: Readonly<Record<string, unknown>>): LineAdapterOptions {
  // Types are checked here, before the constructor: a numeric secret passes the constructor's
  // length check (`adapter.ts:32`) and would throw later, inside the signature HMAC, on the request
  // path. An empty secret or token is then refused by the constructor's own ConfigurationError.
  const channelSecret = requiredString(config, "channelSecret");
  const channelAccessToken = requiredString(config, "channelAccessToken");
  const botUserId = optional(config, "botUserId", isString, "a string");
  const requireMention = optional(config, "requireMention", isBoolean, "a boolean");
  return {
    channelSecret,
    channelAccessToken,
    ...(botUserId !== undefined ? { botUserId } : {}),
    ...(requireMention !== undefined ? { requireMention } : {}),
  };
}

function headerValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/** A LINE webhook envelope: an object whose `events` is an array of objects. */
function isEnvelope(payload: unknown): payload is LineWebhookEnvelope {
  if (typeof payload !== "object" || payload === null) return false;
  const events = (payload as { events?: unknown }).events;
  return (
    Array.isArray(events) && events.every((event) => typeof event === "object" && event !== null)
  );
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally, D4). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "channelSecret",
    required: true,
    secret: true,
    description: "The channel secret that signs inbound webhooks (LINE Developers Console).",
  },
  {
    key: "channelAccessToken",
    required: true,
    secret: true,
    description: "The channel's long-lived access token (LINE Developers Console).",
  },
  {
    key: "botUserId",
    required: false,
    secret: false,
    description: "The bot's own user id; with requireMention, group messages must mention it.",
  },
  {
    key: "requireMention",
    required: false,
    secret: false,
    description: "Whether group messages must mention the bot. Default true.",
  },
];

/**
 * The LINE channel: LINE delivers inbound events by webhook, so the app routes each request to
 * `webhook.verify` and then `webhook.ingest`.
 *
 * `verify` checks the `x-line-signature` header (any case) against the raw body with the adapter's
 * channel secret. `ingest` reports `"malformed"` for a payload with no `events` array or with an
 * event that is not an object, dispatching nothing; otherwise it dispatches through
 * `LineAdapter.dispatchWebhookBody`, which caches each event's reply token so the handler's reply
 * uses the reply API. A follow or other non-text event is skipped and still reports `"delivered"`.
 * It reports `"no_handler"`, dispatching nothing, when the payload holds a text message for the
 * handler and none is subscribed (before the runner started, after it stopped, or when this
 * adapter's connect failed under `connectFailure: "isolate"`). Only `"delivered"` should be
 * answered with 200: with webhook redelivery turned on, LINE redelivers a request answered
 * otherwise.
 * `create` refuses a field of the wrong type, and the adapter refuses an empty secret or token,
 * both with this package's `ConfigurationError`.
 *
 * @public
 */
export const lineChannel = {
  platform: "line" as const,
  transport: "webhook" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): LineAdapter {
    return new LineAdapter(buildOptions(config));
  },
  webhook: {
    verify(
      adapter: LineAdapter,
      request: {
        readonly rawBody: string;
        readonly headers: Readonly<Record<string, string | undefined>>;
      },
    ): boolean {
      const signature = headerValue(request.headers, SIGNATURE_HEADER);
      return verifyLineSignature(adapter.getChannelSecret(), request.rawBody, signature);
    },
    async ingest(
      adapter: LineAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      if (!isEnvelope(payload)) return "malformed";
      const outcome = await adapter.dispatchWebhookBody(payload);
      return outcome === "no_handler" ? "no_handler" : "delivered";
    },
  },
};
