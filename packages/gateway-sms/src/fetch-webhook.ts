/**
 * The SMS (Twilio) half of the descriptor's webhook, answered through `ChannelWebhook.handle` so a
 * host mounts it with `createWebhookHandler`.
 *
 * Twilio signs the public URL plus the form fields, so verification always uses the configured
 * `publicUrl`, never the request's own URL or Host header. The adapter's options are recorded here
 * by the descriptor's `create`, keyed by the adapter, so no secret sits on a public field. An
 * adapter the descriptor did not build has none and every request to it is refused.
 *
 * No secret, signature or body text is logged or answered.
 */

import type { SMSAdapter } from "./adapter.js";
import { parseInbound } from "./parse-inbound.js";
import { verifyTwilioSignature } from "./twilio-verifier.js";
import type { SMSAdapterOptions } from "./types.js";

type TwilioOptions = Extract<SMSAdapterOptions, { backend: "twilio" }>;

const options = new WeakMap<object, TwilioOptions>();

/** Record the options of an adapter the descriptor built. */
export function rememberSmsOptions(adapter: object, opts: TwilioOptions): void {
  options.set(adapter, opts);
}

export interface WebhookRequestShape {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly method?: string;
  readonly url?: string;
}

export interface WebhookAnswerShape {
  readonly status: number;
}

type Outcome = "ok" | "no_handler" | "handler_threw";

/** Same mapping as the core's `statusForDeliver`, kept local so the older peer floor still loads. */
function statusFor(outcomes: ReadonlyArray<Outcome>): 200 | 500 | 503 {
  let status: 200 | 500 | 503 = 200;
  for (const outcome of outcomes) {
    if (outcome === "handler_threw") status = 500;
    else if (outcome === "no_handler" && status === 200) status = 503;
  }
  return status;
}

function lowerHeaders(
  headers: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key.toLowerCase()] = value;
  }
  return out;
}

/** The one check `verify` and `handle` share: Twilio's signature over the configured public URL. */
function verified(opts: TwilioOptions | undefined, request: WebhookRequestShape): boolean {
  if (opts === undefined || opts.authToken.trim().length === 0) return false;
  return verifyTwilioSignature(
    opts.authToken,
    opts.publicUrl,
    request.rawBody,
    lowerHeaders(request.headers)["x-twilio-signature"],
  );
}

function toEvent(opts: TwilioOptions, rawBody: string, headers: Record<string, string>) {
  return parseInbound(opts, { headers, rawBody, url: opts.publicUrl });
}

/** The webhook half of the Twilio descriptor. */
export const twilioWebhook = {
  methods: ["POST"] as const,
  /** The same check `handle` makes; needs no connection. */
  verify(adapter: SMSAdapter, request: WebhookRequestShape): boolean {
    return verified(options.get(adapter), request);
  },
  /** A payload of form fields (as an object) is parsed like the form body and delivered. */
  async ingest(
    adapter: SMSAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    const opts = options.get(adapter);
    if (opts === undefined || payload === null || typeof payload !== "object") return "malformed";
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string") form.set(key, value);
    }
    const event = toEvent(opts, form.toString(), {});
    if (event === null) return "malformed";
    return statusFor([await adapter.deliverQuietly(event)]) === 200 ? "delivered" : "no_handler";
  },
  async handle(adapter: SMSAdapter, request: WebhookRequestShape): Promise<WebhookAnswerShape> {
    const opts = options.get(adapter);
    if (opts === undefined || !verified(opts, request)) return { status: 401 };
    const event = toEvent(opts, request.rawBody, lowerHeaders(request.headers));
    if (event === null) return { status: 400 };
    return { status: statusFor([await adapter.deliverQuietly(event)]) };
  },
};
