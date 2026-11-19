/**
 * The Teams half of the descriptor's webhook, answered through `ChannelWebhook.handle` so a host
 * mounts it with `createWebhookHandler`.
 *
 * The activity is verified with `teamsActivityVerifier` built from the client id alone: a
 * `tenantId` would refuse connector tokens, which carry no `tid` claim. The client id and the
 * bot display name are recorded here by the descriptor's `create`, keyed by the adapter, so nothing
 * sits on a public field; an adapter the descriptor did not build has none and every request to it
 * is refused. Verification is asynchronous, so the standalone `verify` fails closed and the real
 * check happens in `handle`.
 *
 * No token, claim or body text is logged or answered; a refusal is logged by its reason only, and a
 * sender's malformed body is not logged at all.
 */

import { teamsActivityVerifier } from "./activity-verifier.js";
import { normalizeTeamsActivity } from "./normalize.js";
import type { TeamsActivityVerifyResult } from "./verifier-contract.js";

type Verifier = (request: Request) => Promise<TeamsActivityVerifyResult>;

interface Entry {
  readonly clientId: string;
  readonly botDisplayName: string | undefined;
  verifier: Verifier | undefined;
}

const entries = new WeakMap<object, Entry>();

/** Record what the webhook needs of an adapter the descriptor built. @internal */
export function rememberTeamsWebhook(
  adapter: object,
  settings: { readonly clientId: string; readonly botDisplayName?: string },
  verifier?: Verifier,
): void {
  entries.set(adapter, {
    clientId: settings.clientId,
    botDisplayName: settings.botDisplayName,
    verifier,
  });
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

export interface DeliveringAdapter {
  deliver(event: never): Promise<"ok" | "no_handler" | "handler_threw">;
}

/** Same mapping as the core's `statusForDeliver`, kept local so the older peer floor still loads. */
function statusFor(outcome: "ok" | "no_handler" | "handler_threw"): 200 | 500 | 503 {
  if (outcome === "handler_threw") return 500;
  return outcome === "no_handler" ? 503 : 200;
}

function refusalStatus(reason: string): number {
  if (reason === "malformed_body") return 400;
  if (reason === "validator_unavailable" || reason === "key_set_unavailable") return 503;
  return reason === "body_already_read" ? 500 : 401;
}

function verifierOf(entry: Entry): Verifier {
  entry.verifier ??= teamsActivityVerifier({ clientId: entry.clientId });
  return entry.verifier;
}

/** A fresh, unread Fetch request carrying the headers and body the handler already read. */
function toFetchRequest(request: WebhookRequestShape): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, value);
  }
  return new Request(request.url ?? "https://teams.invalid/", {
    method: "POST",
    headers,
    body: request.rawBody,
  });
}

/** Unknown conversation types are dropped so normalization does not log a sender's text. */
function withoutUnknownConversationType(activity: unknown): unknown {
  const act = activity as { conversation?: { conversationType?: unknown } } | null;
  const type = act?.conversation?.conversationType;
  if (type === undefined || type === "personal" || type === "groupChat" || type === "channel") {
    return activity;
  }
  return { ...act, conversation: { ...act?.conversation, conversationType: undefined } };
}

/** The webhook half of the Teams descriptor. */
export const teamsWebhook = {
  methods: ["POST"] as const,
  /** Always `false`: a token check is asynchronous, so only `handle` can make it. */
  verify(_adapter: unknown, _request: WebhookRequestShape): boolean {
    return false;
  },
  /** Refuses every payload: nothing here can show it was verified. */
  async ingest(_adapter: unknown, _payload: unknown): Promise<"malformed"> {
    return "malformed";
  },
  async handle(
    adapter: DeliveringAdapter,
    request: WebhookRequestShape,
  ): Promise<WebhookAnswerShape> {
    const entry = entries.get(adapter);
    if (entry === undefined) return { status: 401 };
    let result: TeamsActivityVerifyResult;
    try {
      result = await verifierOf(entry)(toFetchRequest(request));
    } catch {
      // A verifier that throws is a refusal, never a 500: the Bot Framework would retry a forgery.
      console.warn("teams verifier refused (verifier_threw)");
      return { status: 401 };
    }
    if (!result.ok) {
      const status = refusalStatus(result.reason);
      if (result.reason !== "malformed_body") {
        console.warn(`teams verifier refused (${result.reason})`);
      }
      return { status };
    }
    const activity = result.activity as { type?: unknown };
    if (activity.type !== "message") return { status: 200 };
    const event = normalizeTeamsActivity(
      withoutUnknownConversationType(result.activity),
      entry.botDisplayName,
    );
    const outcome = await adapter.deliver(event as never);
    return { status: statusFor(outcome) };
  },
};
