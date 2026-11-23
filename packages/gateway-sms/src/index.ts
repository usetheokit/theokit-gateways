// Public API for @theokit/gateway-sms (ADRs D389-D396).

export { SMSAdapter } from "./adapter.js";
export { smsChannel } from "./channel.js";
export { BackendNotInstalledError, ConfigurationError } from "./errors.js";
export type { PlaceCallOptions } from "./outbound-call.js";
export { placeCall } from "./outbound-call.js";
export { parseInbound } from "./parse-inbound.js";
export { normalizeE164 } from "./phone.js";
export { splitForSMS } from "./split.js";
export type { TwilioRequestVerifierOptions } from "./twilio-verifier.js";
export { twilioRequestVerifier } from "./twilio-verifier.js";
export { twiml } from "./twiml.js";
export type {
  PlivoOptions,
  SMSAdapterOptions,
  TwilioOptions,
  VonageOptions,
} from "./types.js";
export type { VoiceCallHandlerOptions, VoiceTurn } from "./voice-call-handler.js";
export { createVoiceCallHandler } from "./voice-call-handler.js";
export type { WebhookServer, WebhookServerOptions } from "./webhook-server.js";
export { createWebhookServer } from "./webhook-server.js";
export type { SMSWebhookVerifierOptions, WebhookVerifyResult } from "./webhook-verifier.js";
export { smsWebhookVerifier } from "./webhook-verifier.js";
