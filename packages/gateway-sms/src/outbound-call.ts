/**
 * Outbound Twilio call: one authenticated POST to the Calls REST resource.
 *
 * @public
 */

/** Options for {@link placeCall}. @public */
export interface PlaceCallOptions {
  /** Number to call (E.164). */
  readonly to: string;
  /** Twilio number to call from (E.164). */
  readonly from: string;
  /** URL Twilio fetches TwiML from once the call is answered. */
  readonly url: string;
  readonly credentials: { readonly accountSid: string; readonly authToken: string };
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Start an outbound call and return its call SID. Throws when Twilio answers with a non-2xx
 * status or without a `sid`.
 *
 * @public
 */
export async function placeCall(opts: PlaceCallOptions): Promise<string> {
  const { accountSid, authToken } = opts.credentials;
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: opts.to, From: opts.from, Url: opts.url }).toString(),
    },
  );
  if (!res.ok) throw new Error(`Twilio placeCall failed with status ${res.status}`);
  const json = (await res.json()) as { sid?: unknown };
  if (typeof json.sid !== "string" || json.sid.length === 0) {
    throw new Error("Twilio placeCall response has no sid");
  }
  return json.sid;
}
