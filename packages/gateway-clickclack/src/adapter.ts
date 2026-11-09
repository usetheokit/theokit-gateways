/**
 * `ClickClackAdapter` — `BasePlatformAdapter` over a ClickClack server: messages are posted with
 * `POST /api/channels/{id}/messages` and read from the realtime WebSocket, both with a bot token.
 *
 * @public
 */

import type { OutboundMessage, SendResult } from "@theokit/gateway";
import { RealtimeBotAdapter } from "@theokit/gateway-bot-realtime";

import { refuseAttachments } from "./refuse-attachments.js";
import { splitForClickClack } from "./split.js";
import type { ClickClackAdapterOptions } from "./types.js";

/**
 * ClickClack adapter for one bot.
 *
 * `connect()` opens the realtime socket and answers `true` once it is open, `false`, never a
 * throw, on a refused socket or after 30000 ms. A `message.created` event from someone other than
 * the bot becomes one `ClickClackMessageEvent` (repeats by message id are dropped). A dropped
 * socket is reopened from the last cursor seen. A reply longer than 4000 characters goes as
 * several messages, in order.
 *
 * @public
 */
export class ClickClackAdapter extends RealtimeBotAdapter {
  readonly platform = "clickclack" as const;

  /** @throws Error when `baseUrl`, `token`, `workspaceId` or `botUserId` is missing */
  constructor(opts: ClickClackAdapterOptions) {
    super(opts, { label: "gateway-clickclack", name: "ClickClack", split: splitForClickClack });
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }
}
