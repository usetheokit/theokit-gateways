import type { BasePlatformAdapter, PlatformName } from "@theokit/gateway";
import { GatewayConfigurationError, maskSecrets } from "@theokit/gateway";

import { deliverText } from "./deliver-text.js";

/**
 * Structurally equal to `@theokit/agents`' `DeliverPort`; no dependency on `@theokit/agents`.
 *
 * @public
 */
export type GatewayDeliverPort = (
  target: { readonly platform: string; readonly channelId: string },
  text: string,
) => Promise<{ ok: boolean; error?: { code: string } }>;

/**
 * Adapts gateway adapters to a scheduler's deliver port. `adapters` is read on every send, so a
 * platform that connected later is reached. Text is masked with `options.secrets`, rendered for the
 * platform and sent with `deliverText`. Failures are codes: `not_started` (no adapter for the
 * platform), the adapter's refusal code, or `adapter_threw`.
 *
 * @public
 */
export function gatewayDeliverPort(
  adapters: () => Iterable<BasePlatformAdapter>,
  options?: { secrets?: ReadonlyArray<string> },
): GatewayDeliverPort {
  const secrets = options?.secrets ?? [];
  return async (target, text) => {
    const adapter = findAdapter(adapters(), target.platform);
    if (adapter === undefined) return { ok: false, error: { code: "not_started" } };
    const watched = watchThrows(adapter);
    const failure = await deliverText(
      watched.adapter,
      target.channelId,
      maskSecrets(text, secrets),
      "group",
    );
    if (failure === undefined) return { ok: true };
    return { ok: false, error: { code: watched.threw() ? "adapter_threw" : failure } };
  };
}

function findAdapter(
  adapters: Iterable<BasePlatformAdapter>,
  platform: string,
): BasePlatformAdapter | undefined {
  for (const candidate of adapters) {
    if (candidate.platform === platform) return candidate;
  }
  return undefined;
}

/** Wraps `sendMessage` to record a throw, which `deliverText` reports only as an error name. */
function watchThrows(adapter: BasePlatformAdapter): {
  adapter: BasePlatformAdapter;
  threw: () => boolean;
} {
  let threw = false;
  const watched = {
    platform: adapter.platform,
    sendMessage: async (message: Parameters<BasePlatformAdapter["sendMessage"]>[0]) => {
      try {
        return await adapter.sendMessage(message);
      } catch (error) {
        threw = true;
        throw error;
      }
    },
  } as unknown as BasePlatformAdapter;
  return { adapter: watched, threw: () => threw };
}

/**
 * Parses `"<platform>:<channelId>"`, split at the first colon, so a channel id may contain more
 * colons (Matrix room ids). Throws `GatewayConfigurationError` with code `invalid_channel_target`
 * when a part is missing; the message never quotes the channel id.
 *
 * @public
 */
export function parseChannelTarget(spec: string): { platform: PlatformName; channelId: string } {
  const index = spec.indexOf(":");
  const platform = index < 0 ? "" : spec.slice(0, index);
  const channelId = index < 0 ? "" : spec.slice(index + 1);
  if (platform === "" || channelId === "") {
    throw new GatewayConfigurationError("gateway-agent", {
      code: "invalid_channel_target",
      message: 'gateway-agent: channel target must be "<platform>:<channelId>"',
    });
  }
  return { platform: platform as PlatformName, channelId };
}
