// Public API for @theokit/gateway-google-chat.

export { GoogleChatAdapter, type GoogleChatInbound } from "./adapter.js";
export { chatEventToMessageEvent, type GoogleChatEventBody } from "./normalize.js";
export type { FetchLike, GoogleChatAdapterOptions } from "./types.js";
export {
  createWebhookServer,
  type WebhookServer,
  type WebhookServerOptions,
} from "./webhook-server.js";
