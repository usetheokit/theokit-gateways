// Public API for @theokit/gateway-nextcloud-talk.

export {
  NextcloudTalkAdapter,
  type NextcloudTalkInbound,
  type TalkSignatureHeaders,
} from "./adapter.js";
export { type TalkBodyOutcome, type TalkWebhookBody, talkBodyToMessageEvent } from "./normalize.js";
export { talkSignature, verifyTalkSignature } from "./signature.js";
export { splitForTalk, TALK_MAX_LENGTH } from "./split.js";
export type { FetchLike, NextcloudTalkAdapterOptions } from "./types.js";
export {
  createWebhookServer,
  type WebhookServer,
  type WebhookServerOptions,
} from "./webhook-server.js";
