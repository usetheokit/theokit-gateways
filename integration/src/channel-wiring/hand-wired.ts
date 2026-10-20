/**
 * Telegram and LINE wired by hand, the way an app wired them before B-018 (FR-006).
 *
 * The fixture `measure-app-joinery.mjs --compare` reads as the "before" file. It carries the four
 * per-platform joins NFR-004 counts, each pinned by AC-007: the two constructors, the LINE signature
 * check with `verifyLineSignature`, and the LINE dispatch with `dispatchWebhookBody` (the one public
 * path that caches the reply token). Each channel's required fields are checked before its
 * constructor runs, since an absent LINE option reaches `.length` and throws a TypeError
 * (`packages/gateway-line/src/adapter.ts:32` for the secret). Webhooks are routed through a map
 * keyed by each built adapter's `platform`, so a request's platform is a key, never an operand.
 */

import {
  type BasePlatformAdapter,
  type ChannelRejection,
  GatewayConfigurationError,
  type GatewayHandler,
  GatewayRunner,
  type PlatformName,
  type WebhookRequest,
} from "@theokit/gateway";
import { LineAdapter, type LineWebhookEnvelope, verifyLineSignature } from "@theokit/gateway-line";
import { TelegramAdapter } from "@theokit/gateway-telegram";

/** The configuration both fixtures take. A missing or empty value is a refused channel. */
export type ChannelWiringConfig = {
  readonly telegram: { readonly token?: string };
  readonly line: { readonly channelSecret?: string; readonly channelAccessToken?: string };
};

/** What both fixtures need besides configuration. */
export type ChannelWiringOptions = { readonly handler: GatewayHandler };

/** What `ingestWebhook` did with one request. */
export type WebhookOutcome = "delivered" | "malformed" | "unauthorized" | "unknown_channel";

/** The handling of one platform's webhook requests. */
export type WebhookRoute = (request: WebhookRequest) => Promise<WebhookOutcome>;

/** What both fixtures return: the channels built and refused, a runner not yet started, a router. */
export type ChannelWiring = {
  readonly adapters: ReadonlyArray<BasePlatformAdapter>;
  readonly rejected: ReadonlyArray<ChannelRejection>;
  readonly runner: GatewayRunner;
  ingestWebhook(platform: PlatformName, request: WebhookRequest): Promise<WebhookOutcome>;
};

/** The keys of `values` that are absent or empty. */
function missingKeys(
  values: Readonly<Record<string, string | undefined>>,
  keys: string[],
): string[] {
  return keys.filter((key) => (values[key] ?? "") === "");
}

function rejection(refused: { platform: PlatformName; keys: string[] }): ChannelRejection {
  return {
    platform: refused.platform,
    error: new GatewayConfigurationError("gateway", {
      code: "missing_required_config",
      message: `channel ${refused.platform}: missing required config ${refused.keys.join(", ")}`,
    }),
  };
}

function signatureHeader(headers: WebhookRequest["headers"]): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "x-line-signature");
  return entry?.[1];
}

/** The envelope in a raw body, or `undefined` when it is not JSON with an array of event objects. */
function parseEnvelope(rawBody: string): LineWebhookEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  const events = (parsed as { events?: unknown } | null)?.events;
  const valid = Array.isArray(events) && events.every((e) => typeof e === "object" && e !== null);
  return valid ? (parsed as LineWebhookEnvelope) : undefined;
}

/** Build both channels by hand; the runner is built but not started. */
export function wireChannels(
  config: ChannelWiringConfig,
  { handler }: ChannelWiringOptions,
): ChannelWiring {
  const adapters: BasePlatformAdapter[] = [];
  const rejected: ChannelRejection[] = [];
  const routes = new Map<PlatformName, WebhookRoute>();

  const telegramMissing = missingKeys(config.telegram, ["token"]);
  if (telegramMissing.length > 0) {
    rejected.push(rejection({ platform: "telegram", keys: telegramMissing }));
  } else {
    adapters.push(new TelegramAdapter({ token: config.telegram.token ?? "" }));
  }

  const { channelSecret = "", channelAccessToken = "" } = config.line;
  const lineMissing = missingKeys(config.line, ["channelSecret", "channelAccessToken"]);
  if (lineMissing.length > 0) {
    rejected.push(rejection({ platform: "line", keys: lineMissing }));
  } else {
    const line = new LineAdapter({ channelSecret, channelAccessToken });
    adapters.push(line);
    routes.set(line.platform, async (request) => {
      if (!verifyLineSignature(channelSecret, request.rawBody, signatureHeader(request.headers))) {
        return "unauthorized";
      }
      const envelope = parseEnvelope(request.rawBody);
      if (envelope === undefined) return "malformed";
      await line.dispatchWebhookBody(envelope);
      return "delivered";
    });
  }

  const runner = new GatewayRunner({ adapters, handler, connectFailure: "isolate" });
  return {
    adapters,
    rejected,
    runner,
    ingestWebhook: async (platform, request) =>
      (await routes.get(platform)?.(request)) ?? "unknown_channel",
  };
}
