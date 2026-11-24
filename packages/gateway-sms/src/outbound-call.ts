/**
 * Outbound Twilio call: one authenticated POST to the Calls REST resource.
 *
 * @public
 */

import { ConfigurationError } from "./errors.js";

/** Options for {@link placeCall}. Pass exactly one of `url` and `twiml`. @public */
export interface PlaceCallOptions {
  /** Number to call (E.164). */
  readonly to: string;
  /** Twilio number to call from (E.164). */
  readonly from: string;
  /** URL Twilio fetches TwiML from once the call is answered. Exactly one of `url` and `twiml`. */
  readonly url?: string;
  /** Inline TwiML Twilio runs once the call is answered. Exactly one of `url` and `twiml`. */
  readonly twiml?: string;
  readonly credentials: { readonly accountSid: string; readonly authToken: string };
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Request timeout in milliseconds. Default 15 000. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("***");
  return out;
}

async function twilioMessage(
  res: Response,
  secrets: readonly string[],
): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      return redact(body.message, secrets);
    }
  } catch {
    // unreadable body: fall back to the status alone
  }
  return undefined;
}

/**
 * Start an outbound call and return its call SID. Throws `ConfigurationError` before any request
 * unless exactly one of `url` and `twiml` is given; throws when the request exceeds `timeoutMs`,
 * when Twilio answers with a non-2xx status (the message carries Twilio's `message`, never the
 * credentials), or without a `sid`. Redirects are refused.
 *
 * @public
 */
export async function placeCall(opts: PlaceCallOptions): Promise<string> {
  const hasUrl = typeof opts.url === "string" && opts.url.length > 0;
  const hasTwiml = typeof opts.twiml === "string" && opts.twiml.length > 0;
  if (hasUrl === hasTwiml) {
    throw new ConfigurationError({
      code: "invalid_config",
      message: "gateway-sms: placeCall needs exactly one of url and twiml",
      detail: "url,twiml",
    });
  }
  const { accountSid, authToken } = opts.credentials;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const params = new URLSearchParams({ To: opts.to, From: opts.from });
  if (hasTwiml) params.set("Twiml", opts.twiml as string);
  else params.set("Url", opts.url as string);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Twilio placeCall timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      const res = await doFetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        const message = await twilioMessage(res, [authToken, accountSid]);
        throw new Error(
          `Twilio placeCall failed with status ${res.status}${message ? `: ${message}` : ""}`,
        );
      }
      const json = (await res.json()) as { sid?: unknown };
      if (typeof json.sid !== "string" || json.sid.length === 0) {
        throw new Error("Twilio placeCall response has no sid");
      }
      return json.sid;
    })();
    request.catch(() => {});
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
