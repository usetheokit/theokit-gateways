/** `buzzChannel`: the channel as data, with `BUZZ_*` environment bindings. */

import { type RealtimeBotChannel, realtimeBotChannel } from "@theokit/gateway-bot-realtime";
import { BuzzAdapter } from "./adapter.js";

/**
 * The channel: it opens its own realtime socket in `connect()`, so it needs no webhook route.
 *
 * `create` refuses a missing or wrongly typed value with `GatewayConfigurationError` (prefix
 * `gateway-buzz`, code `invalid_config`, the key in the message); it performs no network call.
 *
 * @public
 */
export const buzzChannel: RealtimeBotChannel<BuzzAdapter, "buzz"> = realtimeBotChannel(
  "gateway-buzz",
  "buzz",
  "BUZZ",
  (options) => new BuzzAdapter(options),
);
