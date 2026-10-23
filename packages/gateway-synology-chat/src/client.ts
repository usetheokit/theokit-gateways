/**
 * The Synology Chat calls the adapter makes through the bot's Incoming URL: `user_list` to prove
 * the URL works, `chatbot` to send. Neither error ever carries the URL, which holds a token.
 */

import type { FetchLike } from "./types.js";

/** One call's outcome. */
export type ChatAnswer = { readonly ok: true } | { readonly ok: false; readonly reason: string };

interface ApiBody {
  readonly success?: unknown;
  readonly error?: { readonly code?: unknown };
}

/** Calls to one bot's Incoming URL. */
export class SynologyChatClient {
  constructor(
    private readonly incomingUrl: string,
    private readonly fetchFn: FetchLike,
  ) {}

  /** List the users the bot can reach; success proves the URL and its token. */
  userList(signal: AbortSignal): Promise<ChatAnswer> {
    return this.call("user_list", undefined, signal);
  }

  /** Send `text` to the user `userId`. */
  post(userId: number, text: string, signal: AbortSignal): Promise<ChatAnswer> {
    const payload = JSON.stringify({ text, user_ids: [userId] });
    return this.call("chatbot", new URLSearchParams({ payload }).toString(), signal);
  }

  private async call(
    method: string,
    body: string | undefined,
    signal: AbortSignal,
  ): Promise<ChatAnswer> {
    const url = new URL(this.incomingUrl);
    url.searchParams.set("method", method);
    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        ...(body === undefined ? {} : { body }),
        signal,
      });
    } catch (err) {
      // A network error's message can quote the URL, and with it the token; only its kind is kept.
      const kind = err instanceof Error ? err.name : "error";
      return { ok: false, reason: `${method} request failed (${kind})` };
    }
    let parsed: ApiBody;
    try {
      parsed = (await response.json()) as ApiBody;
    } catch {
      return { ok: false, reason: `${method} answered HTTP ${response.status} with no JSON body` };
    }
    if (parsed.success === true) return { ok: true };
    const code = parsed.error?.code;
    return {
      ok: false,
      reason: `${method} answered error code ${String(code ?? response.status)}`,
    };
  }
}
