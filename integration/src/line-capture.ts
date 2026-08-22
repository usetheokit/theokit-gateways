/**
 * The policy of the one-shot LINE capture endpoint.
 *
 * `capture:line` opens a PUBLIC `trycloudflare.com` URL so LINE can deliver one
 * webhook, reads `source.userId` out of it, and writes it to `integration/.env`.
 * Until this module existed it accepted whatever arrived: the handler answered
 * `200` to every request and verified nothing (#35), while `LINE_CHANNEL_SECRET`
 * — the credential whose entire purpose is authenticating these deliveries —
 * sat in `.env` already, read by the registry and already validated elsewhere in
 * this repository by `verifyLineSignature` (D408).
 *
 * The window is short and the hostname unguessable. Neither is a control:
 * obscurity was doing work a credential was available to do, and the cost of
 * doing it properly is one function call this monorepo already ships.
 *
 * Kept separate from the script so the decision is a pure function over
 * (secret, bytes, header) — no socket, no filesystem, no tunnel. That is what
 * makes the ordering guarantee below testable, and the ordering IS the security
 * property: the body is not parsed until the signature verifies.
 */

import { verifyLineSignature } from "@theokit/gateway-line";

/** Port the capture server listens on when `LINE_CAPTURE_PORT` is unset. */
const DEFAULT_CAPTURE_PORT = 8787;

/**
 * What a captured user id must look like to be safe to persist.
 *
 * Deliberately NOT a claim about LINE's id format. Real ids are `U` followed by
 * hex, but `@theokit/gateway-line` types `userId` as a plain `string` and its
 * own fixtures use values like `U-alice`, so pinning an exact alphabet here
 * would reject a legitimate id on the strength of a guess — a false negative
 * that breaks the script for the one person running it.
 *
 * What IS asserted is the property that matters at this boundary: the value is
 * written into a `KEY=value` file other tooling parses, so a newline in it
 * would inject a second variable. Printable, non-space ASCII with the
 * documented `U` prefix rules that out without pretending to know more than we
 * do. Authentication says who sent the bytes; it never says they are well-formed.
 */
const USER_ID_PATTERN = /^U[\x21-\x7e]{1,127}$/;

/** Why a delivery was not accepted. Distinct values because they mean different things. */
export type CaptureRejection =
  /** Not from LINE, or tampered with in flight. Nothing was parsed. */
  | "bad_signature"
  /** Authenticated, but not the JSON envelope LINE documents. */
  | "malformed_body"
  /** Authenticated and well-formed, but carries no usable user id — LINE's own
   *  webhook-verification ping and group `leave` events look like this. */
  | "no_user_id";

export type CaptureDecision =
  | { readonly accepted: true; readonly userId: string }
  | { readonly accepted: false; readonly reason: CaptureRejection };

export interface CaptureInput {
  readonly channelSecret: string;
  /** The RAW request bytes as received. Re-serialising parsed JSON breaks the signature. */
  readonly rawBody: string;
  readonly signatureHeader: string | undefined;
}

interface LineEnvelope {
  readonly events?: ReadonlyArray<{ readonly source?: { readonly userId?: unknown } }>;
}

/** Raised when `LINE_CAPTURE_PORT` holds something that is not a usable port. */
export class InvalidPortError extends Error {
  readonly code = "invalid_capture_port";

  constructor(message: string) {
    super(message);
    this.name = "InvalidPortError";
  }
}

/**
 * Decide whether one inbound request may set `LINE_TEST_USER_ID`.
 *
 * Order is deliberate and load-bearing: verify, then parse. An unauthenticated
 * request must reach as little of our parsing as possible, so a hostile body
 * with a bad signature is reported as `bad_signature` and never touches
 * `JSON.parse`.
 */
export function decideCapture(input: CaptureInput): CaptureDecision {
  // An empty secret is not a secret. HMAC with an empty key is a perfectly
  // valid computation, so verifying against one would accept anything signed
  // the same way — absent configuration degrading into weak acceptance, which
  // is worse than refusing.
  if (input.channelSecret.length === 0) return { accepted: false, reason: "bad_signature" };

  if (!verifyLineSignature(input.channelSecret, input.rawBody, input.signatureHeader)) {
    return { accepted: false, reason: "bad_signature" };
  }

  let envelope: LineEnvelope;
  try {
    envelope = JSON.parse(input.rawBody) as LineEnvelope;
  } catch {
    return { accepted: false, reason: "malformed_body" };
  }

  for (const event of envelope.events ?? []) {
    const candidate = event.source?.userId;
    if (typeof candidate === "string" && USER_ID_PATTERN.test(candidate)) {
      return { accepted: true, userId: candidate };
    }
  }

  return { accepted: false, reason: "no_user_id" };
}

/**
 * Parse `LINE_CAPTURE_PORT`, or fail loudly.
 *
 * The previous code was `Number(process.env.LINE_CAPTURE_PORT ?? "8787")`, so a
 * non-numeric value became `NaN` and `server.listen(NaN)` bound a RANDOM port.
 * The tunnel then pointed at a port where nothing was listening, and the
 * failure surfaced minutes later as "LINE never delivered" — a diagnosis
 * aimed at the wrong system entirely.
 */
export function parseCapturePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CAPTURE_PORT;

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InvalidPortError("LINE_CAPTURE_PORT is set but empty — unset it, or give a port.");
  }

  // `Number` accepts "0x1f", " 12 " and "1e3"; a port is written in decimal.
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidPortError(
      `LINE_CAPTURE_PORT must be a decimal port between 1 and 65535, got "${raw}".`,
    );
  }

  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    throw new InvalidPortError(`LINE_CAPTURE_PORT must be between 1 and 65535, got "${raw}".`);
  }

  return port;
}
