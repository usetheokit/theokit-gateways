/**
 * Per-backend HTTP/IPC error → canonical `WhatsAppSendResult.error` shape.
 *
 * Cloud follows Meta error codes (https://developers.facebook.com/docs/graph-api/guides/error-handling).
 * Web follows whatsapp-web.js error strings.
 *
 * @internal
 */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

import type { WhatsAppSendResult } from "./backend-types.js";

type ErrorPayload = Required<WhatsAppSendResult>["error"];

interface MetaErrorBody {
  error?: {
    code?: number;
    message?: string;
    error_subcode?: number;
  };
}

/**
 * Public input shape for the {@link ConfigurationError} constructor.
 *
 * Aliased from the core rather than redeclared. The base type exists precisely so every
 * adapter stops writing its own copy of the same three fields, and a redeclaration means a
 * field added to the core silently never reaches this package. Four siblings alias it the
 * same way.
 */
export type ConfigurationErrorOptions = GatewayConfigurationErrorOptions;

/**
 * A required option is missing or empty.
 *
 * Raised where a consumer hands us configuration — the factories — rather than later, when
 * the value is finally used against the network. A factory that returns an adapter which
 * cannot authenticate has moved the error away from its cause: the stack then names a send,
 * and the mistake was in construction.
 *
 * Matches the shape every sibling adapter uses (`gateway-line`, `gateway-email`, …), which
 * is what makes one `catch (e) { if (e instanceof GatewayConfigurationError) }` work across
 * all of them.
 *
 * @public
 */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: ConfigurationErrorOptions) {
    super("gateway-whatsapp", opts);
  }
}

/**
 * The bridge reported, on its own protocol, that it cannot start.
 *
 * Distinct from {@link WhatsAppConnectTimeoutError}, which says only that nothing arrived in
 * time. This one carries what the bridge said — and, when it could classify itself, a
 * machine-readable `code` such as `peer_missing`, `peer_incompatible` or `peer_load_failed`.
 * The difference matters to a caller: a timeout may be worth retrying, and a peer dependency
 * that does not export what we need never will be.
 *
 * @public
 */
export class WhatsAppBridgeError extends Error {
  override readonly name = "WhatsAppBridgeError";
  /** Cause as named by the bridge, when it could name one. */
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(`WhatsApp web bridge could not start: ${message}`);
    this.code = code;
  }
}

/** Custom error: `connect()` timed out waiting for "ready" (EC-6). */
export class WhatsAppConnectTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`WhatsApp web bridge connect timed out after ${timeoutMs}ms (QR code not scanned?)`);
    this.name = "WhatsAppConnectTimeoutError";
  }
}

/**
 * Meta's published error codes, by consequence for the caller.
 *
 * These are six-digit codes, and the mapper used to test `errCode === 130 || errCode === 131`
 * — a condition no Cloud API response can satisfy. The rate-limit branch was dead, every real
 * throttle arrived as `invalid_request`, and a consumer's backoff never fired (#46). The unit
 * test that claimed to cover it passed on the HTTP status while feeding a fabricated code.
 *
 * Numbers verified against Meta's error-code table rather than recalled.
 */
const RATE_LIMIT_CODES = new Set([
  4, // the app reached its API call rate limit
  80007, // the WhatsApp Business Account reached its rate limit
  130429, // Cloud API message throughput reached
]);
const UNDELIVERABLE_CODES = new Set([
  130403, // the business has blocked this user
  131026, // no WhatsApp account, terms not accepted, or an outdated client
]);
/** More than 24h since the recipient last replied. Remedy: resend as a template. */
const SESSION_WINDOW_EXPIRED_CODE = 131047;

function cloudErrorCode(
  status: number,
  errCode: number,
):
  | "auth_failed"
  | "rate_limit"
  | "invalid_request"
  | "session_window_expired"
  | "undeliverable"
  | "server_error"
  | "unknown" {
  if (errCode === 190 || status === 401) return "auth_failed";
  if (RATE_LIMIT_CODES.has(errCode) || status === 429) return "rate_limit";
  // Ordered before the generic 400 branch: all three arrive as HTTP 400, and the
  // specific code is the only thing separating "fix your payload" from "send a
  // template" and from "this recipient will never receive it".
  if (errCode === SESSION_WINDOW_EXPIRED_CODE) return "session_window_expired";
  if (UNDELIVERABLE_CODES.has(errCode)) return "undeliverable";
  if (status === 400 || errCode === 100) return "invalid_request";
  if (status >= 500) return "server_error";
  return "unknown";
}

/**
 * Map a Cloud API HTTP failure into the canonical `{ code, message }` payload.
 *
 * Takes the status alongside the body because Meta returns the same envelope shape for very
 * different faults, and the status is what separates a rejected payload from an expired token.
 */
export function mapWhatsAppCloudError(status: number, body: unknown): ErrorPayload {
  const parsed = (body !== null && typeof body === "object" ? body : {}) as MetaErrorBody;
  const errCode = parsed.error?.code ?? 0;
  const errMsg = parsed.error?.message ?? `HTTP ${status}`;
  const code = cloudErrorCode(status, errCode);
  if (code === "auth_failed") return { code, message: `Bearer token rejected: ${errMsg}` };
  if (code === "rate_limit") return { code, message: `Throttled: ${errMsg}` };
  if (code === "session_window_expired") {
    // The remedy travels with the error. A caller reading only the code knows to
    // switch to a template; a human reading a log should not have to look it up.
    return {
      code,
      message: `Outside the 24-hour service window — send an approved template instead: ${errMsg}`,
    };
  }
  return { code, message: errMsg };
}

/**
 * Map an error string from the `whatsapp-web.js` bridge into the canonical payload.
 *
 * The bridge speaks over IPC and can only send text, so this is the boundary where a line of stderr
 * becomes a structured error. `undefined` maps to an `unknown` code rather than throwing.
 */
export function mapWhatsAppWebError(ipcError: string | undefined): ErrorPayload {
  const msg = ipcError ?? "unknown bridge error";
  if (msg.includes("AUTHENTICATION") || msg.includes("UNAUTHORIZED")) {
    return { code: "auth_failed", message: msg };
  }
  if (msg.includes("RATE") || msg.includes("THROTTLE")) {
    return { code: "rate_limit", message: msg };
  }
  if (msg.includes("PROTOCOL") || msg.includes("DISCONNECT")) {
    return { code: "server_error", message: msg };
  }
  if (msg.includes("TIMEOUT")) {
    return { code: "timeout", message: msg };
  }
  return { code: "unknown", message: msg };
}
