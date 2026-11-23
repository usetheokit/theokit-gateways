/**
 * Voice conversation loop over the Twilio verifier and the TwiML builders.
 *
 * Silence counts are held in memory per call; run one instance, or route a call to the same
 * instance, and they are dropped when the call ends.
 *
 * @public
 */

import { verifyTwilioSignature } from "./twilio-verifier.js";
import { twiml } from "./twiml.js";

/** What the caller said, handed to `turn`. @public */
export interface VoiceTurn {
  readonly from: string;
  readonly callSid: string;
  readonly text: string;
}

/** Options for {@link createVoiceCallHandler}. @public */
export interface VoiceCallHandlerOptions {
  readonly authToken: string;
  /** The URL Twilio POSTs to; also the gather `action`. Defaults to the request URL. */
  readonly publicUrl?: string;
  /** Produce the spoken reply for one utterance. */
  readonly turn: (turn: VoiceTurn) => Promise<string> | string;
  /** Caller numbers allowed to talk, matched exactly against `From`. Others are hung up on. */
  readonly allowed: readonly string[];
  /** Utterances that end the call. */
  readonly goodbye?: RegExp | ((text: string) => boolean);
  /** First prompt. Default `"Hello."` */
  readonly greeting?: string;
  /** Said before hanging up. Default `"Goodbye."` */
  readonly goodbyeText?: string;
  /** Silent turns in a row before hanging up. Default 2. */
  readonly maxSilence?: number;
}

function form(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function isGoodbye(g: VoiceCallHandlerOptions["goodbye"], text: string): boolean {
  if (g === undefined) return false;
  if (typeof g === "function") return g(text);
  g.lastIndex = 0;
  return g.test(text);
}

/**
 * Build a Fetch handler for Twilio voice webhooks: it verifies the signature, hangs up on callers
 * outside `allowed`, answers with a speech `<Gather>` and calls `turn` for each utterance.
 *
 * @public
 */
export function createVoiceCallHandler(
  opts: VoiceCallHandlerOptions,
): (request: Request) => Promise<Response> {
  const silences = new Map<string, number>();
  const maxSilence = opts.maxSilence ?? 2;
  const bye = opts.goodbyeText ?? "Goodbye.";
  const gather = (action: string, prompt: string): Response =>
    xml(
      twiml.response(
        twiml.gather({
          action,
          input: "speech",
          speechTimeout: "auto",
          method: "POST",
          prompt,
        }),
      ),
    );
  const end = (callSid: string | null, say?: string): Response => {
    if (callSid) silences.delete(callSid);
    return xml(twiml.response(...(say === undefined ? [] : [twiml.say(say)]), twiml.hangup()));
  };

  const converse = async (action: string, t: VoiceTurn | null, callSid: string) => {
    if (t === null) {
      const n = (silences.get(callSid) ?? -1) + 1;
      if (n > maxSilence) return end(callSid, bye);
      silences.set(callSid, n);
      return gather(action, opts.greeting ?? "Hello.");
    }
    silences.set(callSid, 0);
    if (isGoodbye(opts.goodbye, t.text)) return end(callSid, bye);
    return gather(action, await opts.turn(t));
  };

  return async (request) => {
    const action = opts.publicUrl ?? request.url;
    const body = await request.text();
    const signature = request.headers.get("x-twilio-signature") ?? undefined;
    if (!verifyTwilioSignature(opts.authToken, action, body, signature)) {
      return new Response("invalid signature", { status: 403 });
    }
    const p = form(body);
    const from = p.get("From");
    const callSid = p.get("CallSid");
    if (!from || !callSid) return new Response("missing From or CallSid", { status: 400 });
    if (p.get("CallStatus") === "completed" || !opts.allowed.includes(from)) return end(callSid);
    const text = p.get("SpeechResult")?.trim() ?? "";
    return converse(action, text === "" ? null : { from, callSid, text }, callSid);
  };
}
