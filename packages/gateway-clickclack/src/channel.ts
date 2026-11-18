/** `clickclackChannel`: the channel as data, with `CLICKCLACK_*` environment bindings. */

import { type RealtimeBotChannel, realtimeBotChannel } from "@theokit/gateway-bot-realtime";
import { ClickClackAdapter } from "./adapter.js";

/**
 * The channel: it opens its own realtime socket in `connect()`, so it needs no webhook route.
 *
 * `create` refuses a missing or wrongly typed value with `GatewayConfigurationError` (prefix
 * `gateway-clickclack`, code `invalid_config`, the key in the message); it performs no network call.
 *
 * @public
 */
export const clickclackChannel: RealtimeBotChannel<ClickClackAdapter, "clickclack"> = realtimeBotChannel(
  "gateway-clickclack",
  "clickclack",
  "CLICKCLACK",
  (options) => new ClickClackAdapter(options),
);
