// Public API for @theokit/gateway (Hermes #gateway-port, ADRs D170-D181).

// Adapter contract
export {
  BasePlatformAdapter,
  type OutboundMessage,
  type SendResult,
} from "./adapter/base.js";
// Delivery
export {
  type DeliveryRequest,
  DeliveryRouter,
  type DeliveryTarget,
} from "./delivery/router.js";
// Errors
export {
  GatewayConfigurationError,
  type GatewayConfigurationErrorOptions,
} from "./errors/config-error.js";
export {
  GatewayLifecycleError,
  type GatewayLifecycleErrorOptions,
} from "./errors/lifecycle-error.js";
// Hooks
export { HookExecutor } from "./hooks/executor.js";
export type {
  GatewayHook,
  HookDecision,
  HookName,
  OnErrorContext,
  PostOutboundContext,
  PreInboundContext,
} from "./hooks/types.js";
// Runner
export {
  type GatewayContext,
  type GatewayHandler,
  GatewayRunner,
  type GatewayRunnerOptions,
} from "./runner/gateway-runner.js";
// Session
export {
  type AgentIdStrategy,
  defaultStrategy,
  SessionRouter,
} from "./session/router.js";
// Text
export {
  type ChunkByGraphemeOptions,
  type ChunkTextOptions,
  chunkByGrapheme,
  chunkText,
} from "./text/chunk.js";
// Types
export type {
  BaseMessageEvent,
  DiscordMessageEvent,
  EmailMessageEvent,
  LineMessageEvent,
  MatrixMessageEvent,
  MattermostMessageEvent,
  MessageEvent,
  PlatformEventRegistry,
  PlatformName,
  SlackMessageEvent,
  SMSMessageEvent,
  TeamsMessageEvent,
  TelegramMessageEvent,
  WhatsAppMessageEvent,
} from "./types/message-event.js";
