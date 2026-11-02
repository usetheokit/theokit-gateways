/**
 * The adapter the live Discord inbound probe listens with.
 *
 * The probe posts an unmentioned message into a guild channel and waits for it to arrive, which
 * tests transport: the websocket and the privileged MessageContent intent. Mention gating is
 * covered offline in `packages/gateway-discord/tests`, so the probe's adapter turns it off; under
 * the default (`requireMention: true`) the probe's message would be dropped and the suite would
 * read an outage that is not one.
 */

import { DiscordAdapter } from "@theokit/gateway-discord";

export function inboundProbeAdapter(token: string): DiscordAdapter {
  return new DiscordAdapter({ token, requireMention: false });
}
