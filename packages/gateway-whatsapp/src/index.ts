/**
 * `@theokit/gateway-whatsapp` — public API.
 *
 * Multi-backend (Cloud + Web) WhatsApp adapter for `@theokit/gateway`.
 * See README for setup walkthroughs.
 *
 * @public
 */

// Re-export the MessageEvent variant for consumer-side ergonomics.
export type { WhatsAppMessageEvent } from "@theokit/gateway";
export {
  digitsOnly,
  WhatsAppAdapter,
  type WhatsAppAdapterCommonOptions,
  type WhatsAppAdapterOptions,
  type WhatsAppBaileysConfig,
  type WhatsAppCloudConfig,
  type WhatsAppWebConfig,
} from "./adapter.js";
// Baileys backend (WhatsApp Web multi-device protocol, no browser).
export {
  WhatsAppBaileysBackend,
  type WhatsAppBaileysBackendOptions,
} from "./backend/baileys/index.js";
export {
  type BaileysSocketFactory,
  type BaileysSocketLike,
  type BaileysSocketOptions,
  createBaileysSocket,
} from "./backend/baileys/socket.js";
// Cloud backend (Meta WhatsApp Business Cloud API).
export {
  WhatsAppCloudBackend,
  type WhatsAppCloudBackendOptions,
} from "./backend/cloud/index.js";
export type { MetaTemplateComponent } from "./backend/cloud/types.js";
// Webhook helpers (caller wires into their HTTP route).
export {
  normalizeInboundMessages,
  normalizeStatusReceipts,
  parseWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookSubscription,
} from "./backend/cloud/webhook.js";

// Web bridge backend (whatsapp-web.js subprocess).
export {
  defaultBridgeScriptPath,
  WhatsAppWebBackend,
  type WhatsAppWebBackendOptions,
} from "./backend/web/index.js";

// IPC helpers (advanced — typically not needed unless writing a custom bridge).
export {
  formatCommand,
  type IpcCommand,
  type IpcEvent,
  LineBuffer,
  parseEvent,
} from "./backend/web/ipc.js";
export type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
  WhatsAppStatusReceipt,
} from "./backend-types.js";

// Errors.
export {
  ConfigurationError,
  type ConfigurationErrorOptions,
  mapWhatsAppCloudError,
  mapWhatsAppWebError,
  WhatsAppBridgeError,
  WhatsAppConnectTimeoutError,
} from "./errors.js";
export { splitForWhatsApp } from "./split.js";
