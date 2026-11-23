// Public API for @theokit/gateway (Hermes #gateway-port, ADRs D170-D181).

// Adapter contract
export {
  type AdapterCapabilities,
  BasePlatformAdapter,
  type OutboundAttachment,
  type OutboundMessage,
  type SendError,
  type SendErrorCode,
  type SendResult,
} from "./adapter/base.js";
export type {
  JsonRpcChild,
  RpcNotification,
  RpcOutcome,
} from "./adapter/json-rpc-line.js";
export { JsonRpcLineClient } from "./adapter/json-rpc-line.js";
export { sendErrorFromHttp } from "./adapter/send-error.js";
export {
  WeixinAdapterBase,
  type WeixinAdapterConfig,
  type WeixinFetch,
  type WeixinSendRequest,
  type WeixinWebhookAnswer,
} from "./adapter/weixin-base.js";
export { parseFlatXml } from "./adapter/weixin-xml.js";
// A JWKS key-set cache and RS256 JWT signature verification (claims stay with the caller).
export {
  type DecodedJwt,
  decodeJwt,
  type JwksKeySet,
  type JwksKeySetOptions,
  type JwksLookup,
  jwksKeySet,
  type VerifyJwtResult,
  verifyRs256Jwt,
} from "./auth/jwks.js";
export type { FetchedToken, TokenCache, TokenCacheOptions } from "./auth/token-cache.js";
export { createTokenCache } from "./auth/token-cache.js";
export {
  type ChannelConfigInput,
  type ChannelConfigReaders,
  channelConfigReaders,
} from "./channel/channel-config-readers.js";
// Channels described as data (B-018)
export type {
  ChannelConfigField,
  ChannelDeps,
  ChannelDescriptor,
  ChannelWebhook,
  IngestResult,
  SenderIdentity,
  WebhookAnswer,
  WebhookRequest,
} from "./channel/channel-descriptor.js";
export { isAuthenticatedSender } from "./channel/channel-descriptor.js";
export {
  configFromEnv,
  type EnvConfig,
  type EnvOptions,
  selectVariant,
} from "./channel/config-from-env.js";
export {
  type BuiltChannel,
  type ChannelEntry,
  type ChannelRejection,
  type CreateChannelsResult,
  createChannels,
} from "./channel/create-channels.js";
export { refuseUnsupportedAttachments } from "./delivery/attachments.js";
// Delivery
export {
  type DeliveryRequest,
  DeliveryRouter,
  type DeliveryTarget,
} from "./delivery/router.js";
export { type ReportDiagnosticOptions, reportDiagnostic } from "./diagnostics.js";
// Errors
export {
  GatewayConfigurationError,
  type GatewayConfigurationErrorOptions,
} from "./errors/config-error.js";
export {
  GatewayLifecycleError,
  type GatewayLifecycleErrorOptions,
} from "./errors/lifecycle-error.js";
export {
  type AccessPolicyMessages,
  type AccessPolicyOptions,
  createAccessPolicyHook,
  type DmPolicy,
} from "./hooks/access-policy.js";
// Hooks
export {
  type ChatCommand,
  commandHook,
  helpText,
  type ParsedChatCommand,
  parseChatCommand,
} from "./hooks/chat-command.js";
export { HookExecutor } from "./hooks/executor.js";
export {
  createFilePairingStore,
  type PairingStore,
  senderKey,
} from "./hooks/pairing-store.js";
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
  type AdapterState,
  type ConnectFailure,
  type GatewayContext,
  type GatewayHandler,
  GatewayRunner,
  type GatewayRunnerOptions,
  type ReconnectPolicy,
  type StartResult,
} from "./runner/gateway-runner.js";
export {
  type MediaUnderstandingOptions,
  withMediaUnderstanding,
} from "./runner/media-understanding.js";
export { ReconnectBackoff, type ReconnectBackoffOptions } from "./runner/reconnect-backoff.js";
export type { CoveredShape, UncoveredShape } from "./security/credential-patterns.js";
export {
  CREDENTIAL_SHAPES,
  maskSecrets,
  maskShapes,
  redactSecrets,
} from "./security/credential-patterns.js";
export type { CredentialStore } from "./security/credential-store.js";
export { createFileCredentialStore } from "./security/credential-store.js";
// Session
export {
  type AgentBindingRule,
  type AgentBindings,
  type AgentBindingsOptions,
  bindingStrategy,
  createAgentBindings,
} from "./session/bindings.js";
export {
  type AgentIdStrategy,
  defaultStrategy,
  SessionRouter,
} from "./session/router.js";
export {
  type DmScope,
  type ScopedStrategyOptions,
  scopedStrategy,
} from "./session/scoped-strategy.js";
// Text
export { type ChannelRendering, channelRendering } from "./text/channel-rendering.js";
export {
  type ChunkByGraphemeOptions,
  type ChunkTextOptions,
  chunkByGrapheme,
  chunkText,
} from "./text/chunk.js";
export { toDialect } from "./text/dialect.js";
export { type FenceRegion, scanFences } from "./text/fence.js";
export { SeenIds } from "./text/seen-ids.js";
export { type SplitKeepingRowsOptions, splitKeepingRows } from "./text/split-rows.js";
// Types
export type {
  BaseMessageEvent,
  DiscordMessageEvent,
  EmailMessageEvent,
  InboundAudio,
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
  BuzzMessageEvent,
  ClickClackMessageEvent,
  FeishuLarkMessageEvent,
  GoogleChatMessageEvent,
  IMessageMessageEvent,
  IrcMessageEvent,
  NextcloudTalkMessageEvent,
  NostrMessageEvent,
  QQMessageEvent,
  RaftMessageEvent,
  SignalMessageEvent,
  SynologyChatMessageEvent,
  TlonUrbitMessageEvent,
  TwitchMessageEvent,
  WeChatMessageEvent,
  WeComMessageEvent,
  XMessageEvent,
  XThreadTweet,
  YuanbaoMessageEvent,
  ZaloMessageEvent,
  ZaloPersonalMessageEvent,
} from "./types/platform-events.js";
// A Fetch handler that routes webhook requests to the channels' descriptors.
export { statusForDeliver } from "./webhook/deliver-status.js";
// The shared half of an Express webhook server — see `webhook/express-server.ts` for why it lives
// here and why it does not make express a dependency of the core (#89).
export type {
  ListenableApp,
  ListenerLike,
  RawBodyCaptureOptions,
  RawBodyRequest,
} from "./webhook/express-server.js";
export {
  DEFAULT_WEBHOOK_MAX_BYTES,
  listenerLifecycle,
  loadPeer,
  rawBodyCapture,
} from "./webhook/express-server.js";
export { createWebhookHandler, type WebhookHandlerOptions } from "./webhook/fetch-handler.js";
export {
  type DigestEncoding,
  safeEqualString,
  type VerifyHmacOptions,
  verifyDigest,
  verifyHmac,
} from "./webhook/verify-signature.js";
