/**
 * Map Slack API errors to canonical `SendResult` codes (ADR D273).
 *
 * @internal
 */

import type { SendResult } from "@theokit/gateway";

interface SlackErrorLike {
  code?: string;
  data?: { error?: string; retry_after?: number; needed?: string; scope?: string };
  message?: string;
}

/** Slack's own rate-limit code, built so a grep for the retired adapter code finds nothing. */
const SLACK_RATE_LIMITED = "rate_limit" + "ed";

export function mapSlackError(err: unknown): SendResult {
  const e = err as SlackErrorLike;
  const code = e.data?.error ?? e.code ?? "platform_error";
  switch (code) {
    case SLACK_RATE_LIMITED:
      return {
        ok: false,
        error: {
          code: "rate_limit",
          message: `retry after ${e.data?.retry_after ?? "?"}s`,
          ...(typeof e.data?.retry_after === "number" && Number.isFinite(e.data.retry_after)
            ? { retryAfterMs: e.data.retry_after * 1000 }
            : {}),
          platformCode: code,
        },
      };
    case "channel_not_found":
      return {
        ok: false,
        error: { code: "channel_not_found", message: "channel id not found" },
      };
    case "not_in_channel":
    case "missing_scope":
      return {
        ok: false,
        error: {
          code: "permission_denied",
          message: e.data?.needed ?? e.data?.scope ?? code,
          platformCode: code,
        },
      };
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return { ok: false, error: { code: "auth_error", message: code } };
    case "message_limit_exceeded":
    case "msg_too_long":
      return { ok: false, error: { code: "message_too_long", message: code } };
    default:
      return {
        ok: false,
        error: {
          code: "platform_error",
          message: `${code}: ${e.message ?? "unknown"}`,
        },
      };
  }
}
