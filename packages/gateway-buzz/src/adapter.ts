/**
 * `BuzzAdapter` — `BasePlatformAdapter` over a Buzz server: messages are posted with
 * `POST /api/channels/{id}/messages` and read from the realtime WebSocket, both with a bot token.
 *
 * @public
 */

import type { OutboundMessage, SendResult } from "@theokit/gateway";
import { RealtimeBotAdapter } from "@theokit/gateway-bot-realtime";

import { refuseAttachments } from "./refuse-attachments.js";
import { splitForBuzz } from "./split.js";
import type { BuzzAdapterOptions } from "./types.js";

/**
 * Buzz adapter for one bot.
 *
 * `connect()` opens the realtime socket and answers `true` once it is open, `false`, never a
 * throw, on a refused socket or after 30000 ms. A `message.created` event from someone other than
 * the bot becomes one `BuzzMessageEvent` (repeats by message id are dropped). A dropped
 * socket is reopened from the last cursor seen. A reply longer than 4000 characters goes as
 * several messages, in order.
 *
 * @public
 */
export class BuzzAdapter extends RealtimeBotAdapter {
  readonly platform = "buzz" as const;

  /** @throws Error when `baseUrl`, `token`, `workspaceId` or `botUserId` is missing */
  constructor(opts: BuzzAdapterOptions) {
    super(opts, { label: "gateway-buzz", name: "Buzz", split: splitForBuzz });
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }
}
