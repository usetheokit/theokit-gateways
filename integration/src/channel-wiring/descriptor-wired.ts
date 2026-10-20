/**
 * Telegram and LINE wired from their descriptors, with no per-platform branch (FR-006 of B-018).
 *
 * The fixture `measure-app-joinery.mjs --compare` reads as the "after" file. It builds every
 * adapter through `createChannels`, routes a webhook by the descriptor's `platform` (a map lookup,
 * never a comparison with a name) and verifies and ingests it through the descriptor's `webhook`
 * part. Adding a channel is one more entry in `descriptors`.
 *
 * The list's annotation is also ADR D4's conformance check: the platform packages type their
 * descriptors locally, and this assignment to the core's `ChannelDescriptor` is where the two must
 * agree or the integration typecheck fails.
 */

import {
  type BasePlatformAdapter,
  type ChannelDescriptor,
  createChannels,
  GatewayRunner,
  type PlatformName,
} from "@theokit/gateway";
import { lineChannel } from "@theokit/gateway-line";
import { telegramChannel } from "@theokit/gateway-telegram";

import type {
  ChannelWiring,
  ChannelWiringConfig,
  ChannelWiringOptions,
  WebhookOutcome,
  WebhookRoute,
} from "./hand-wired.js";

const descriptors: ReadonlyArray<ChannelDescriptor<BasePlatformAdapter>> = [
  telegramChannel,
  lineChannel,
];
const descriptorsByPlatform = new Map(descriptors.map((d) => [d.platform, d]));

/** Parse a body; `undefined` only when it is not JSON at all. */
function parseBody(rawBody: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(rawBody) };
  } catch {
    return undefined;
  }
}

function routeFor(adapter: BasePlatformAdapter): WebhookRoute | undefined {
  const webhook = descriptorsByPlatform.get(adapter.platform)?.webhook;
  if (webhook === undefined) return undefined;
  return async (request): Promise<WebhookOutcome> => {
    if (!webhook.verify(adapter, request)) return "unauthorized";
    const parsed = parseBody(request.rawBody);
    if (parsed === undefined) return "malformed";
    return webhook.ingest(adapter, parsed.value);
  };
}

/** Build both channels from their descriptors; the runner is built but not started. */
export function wireChannels(
  config: ChannelWiringConfig,
  { handler }: ChannelWiringOptions,
): ChannelWiring {
  const configByPlatform: Partial<Record<PlatformName, Readonly<Record<string, unknown>>>> = config;
  const { adapters, rejected } = createChannels(
    descriptors.map((descriptor) => ({
      descriptor,
      config: configByPlatform[descriptor.platform],
    })),
  );
  const routes = new Map<PlatformName, WebhookRoute>();
  for (const adapter of adapters) {
    const route = routeFor(adapter);
    if (route !== undefined) routes.set(adapter.platform, route);
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
