// Public API for @theokit/gateway (Hermes #gateway-port, ADRs D170-D181).

// Adapter contract
export {
  BasePlatformAdapter,
  type OutboundAttachment,
  type OutboundMessage,
  type SendResult,
} from "./adapter/base.js";
// Channels described as data (B-018)
export type {
  ChannelConfigField,
  ChannelDescriptor,
  ChannelWebhook,
  IngestResult,
  WebhookRequest,
} from "./channel/channel-descriptor.js";
export {
  type ChannelEntry,
  type ChannelRejection,
  type CreateChannelsResult,
  createChannels,
} from "./channel/create-channels.js";
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
  type ConnectFailure,
  type GatewayContext,
  type GatewayHandler,
  GatewayRunner,
  type GatewayRunnerOptions,
  type StartResult,
} from "./runner/gateway-runner.js";
export type { CoveredShape, UncoveredShape } from "./security/credential-patterns.js";
export {
  CREDENTIAL_SHAPES,
  maskShapes,
  redactSecrets,
} from "./security/credential-patterns.js";
// Session
export {
  type AgentIdStrategy,
  defaultStrategy,
  SessionRouter,
} from "./session/router.js";
// Text
export { type ChannelRendering, channelRendering } from "./text/channel-rendering.js";
export {
  type ChunkByGraphemeOptions,
  type ChunkTextOptions,
  chunkByGrapheme,
  chunkText,
} from "./text/chunk.js";
export { toDialect } from "./text/dialect.js";
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
export type {
  FeishuLarkMessageEvent,
  GoogleChatMessageEvent,
  IMessageMessageEvent,
  IrcMessageEvent,
  NextcloudTalkMessageEvent,
  NostrMessageEvent,
  SignalMessageEvent,
  SynologyChatMessageEvent,
  TlonUrbitMessageEvent,
  TwitchMessageEvent,
} from "./types/platform-events.js";

// The shared half of an Express webhook server — see `webhook/express-server.ts` for why it lives
// here and why it does not make express a dependency of the core (#89).
export type {
  ListenableApp,
  ListenerLike,
  RawBodyCaptureOptions,
  RawBodyRequest,
} from "./webhook/express-server.js";
export { listenerLifecycle, loadPeer, rawBodyCapture } from "./webhook/express-server.js";
