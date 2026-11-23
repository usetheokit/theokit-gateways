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
  /**
   * Silent turns in a row (the caller was prompted and said nothing) before hanging up. The first
   * request of a call only greets and does not count. Default 2.
   */
  readonly maxSilence?: number;
  /**
   * Milliseconds without a request after which a call's state is dropped. Twilio does not tell
   * the gather action when a caller hangs up mid-call. Default one hour.
   */
  readonly stateTtlMs?: number;
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
  const silences = new Map<string, { count: number; at: number }>();
  const maxSilence = opts.maxSilence ?? 2;
  const ttl = opts.stateTtlMs ?? 3_600_000;
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
  const end = (callSid: string, say?: string): Response => {
    silences.delete(callSid);
    return xml(twiml.response(...(say === undefined ? [] : [twiml.say(say)]), twiml.hangup()));
  };
  const sweep = (now: number): void => {
    for (const [sid, st] of silences) if (now - st.at > ttl) silences.delete(sid);
  };

  const silent = (action: string, callSid: string, now: number): Response => {
    const prev = silences.get(callSid);
    if (prev === undefined) {
      silences.set(callSid, { count: 0, at: now });
      return gather(action, opts.greeting ?? "Hello.");
    }
    const count = prev.count + 1;
    if (count >= maxSilence) return end(callSid, bye);
    silences.set(callSid, { count, at: now });
    return gather(action, opts.greeting ?? "Hello.");
  };

  const spoken = async (action: string, t: VoiceTurn, now: number): Promise<Response> => {
    silences.set(t.callSid, { count: 0, at: now });
    if (isGoodbye(opts.goodbye, t.text)) return end(t.callSid, bye);
    return gather(action, await opts.turn(t));
  };

  type Parsed =
    | { kind: "reply"; response: Response }
    | { kind: "end"; callSid: string }
    | { kind: "silence"; callSid: string }
    | { kind: "turn"; turn: VoiceTurn };

  const classify = (p: URLSearchParams): Parsed => {
    const from = p.get("From");
    const callSid = p.get("CallSid");
    if (!from || !callSid) {
      return { kind: "reply", response: new Response("missing From or CallSid", { status: 400 }) };
    }
    if (p.get("CallStatus") === "completed" || !opts.allowed.includes(from)) {
      return { kind: "end", callSid };
    }
    const text = p.get("SpeechResult")?.trim() ?? "";
    return text === ""
      ? { kind: "silence", callSid }
      : { kind: "turn", turn: { from, callSid, text } };
  };

  const parse = async (request: Request, action: string): Promise<Parsed> => {
    const body = await request.text();
    const signature = request.headers.get("x-twilio-signature") ?? undefined;
    if (verifyTwilioSignature(opts.authToken, action, body, signature)) return classify(form(body));
    return { kind: "reply", response: new Response("invalid signature", { status: 403 }) };
  };

  return async (request) => {
    const action = opts.publicUrl ?? request.url;
    const parsed = await parse(request, action);
    const now = Date.now();
    sweep(now);
    if (parsed.kind === "reply") return parsed.response;
    if (parsed.kind === "end") return end(parsed.callSid);
    if (parsed.kind === "silence") return silent(action, parsed.callSid, now);
    return spoken(action, parsed.turn, now);
  };
}
