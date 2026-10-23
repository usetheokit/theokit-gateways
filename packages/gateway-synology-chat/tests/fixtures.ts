/** Fixtures shared by the Synology Chat tests: a scripted NAS and a free port. */

import { createServer } from "node:net";

import type { FetchLike } from "../src/types.js";

export const BOT_TOKEN = "outgoing-token-abc";
export const INCOMING_URL =
  "https://nas.example:5001/webapi/entry.cgi?api=SYNO.Chat.External&method=chatbot&version=2&token=%22incoming-secret-xyz%22";

/** One request the scripted NAS received. */
export interface NasCall {
  readonly url: URL;
  readonly body: string;
}

/** A NAS answering `user_list` and `chatbot` with what the test sets. */
export class ScriptedNas {
  readonly calls: NasCall[] = [];
  userList: () => Promise<Response> = async () =>
    Response.json({ success: true, data: { users: [] } });
  chatbot: () => Promise<Response> = async () => Response.json({ success: true });

  readonly fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? init.body : "";
    this.calls.push({ url, body });
    const answer =
      url.searchParams.get("method") === "user_list" ? this.userList() : this.chatbot();
    return waitOrAbort(answer, init?.signal);
  };

  /** The `payload` of every chatbot post, parsed. */
  posts(): Array<{ text: string; user_ids: number[] }> {
    return this.calls
      .filter((call) => call.url.searchParams.get("method") === "chatbot")
      .map((call) => JSON.parse(new URLSearchParams(call.body).get("payload") ?? "{}"));
  }
}

function waitOrAbort(
  answer: Promise<Response>,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (signal === null || signal === undefined) return answer;
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
    answer.then(resolve, reject);
  });
}

/** A port nothing listens on right now. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === "object" && address !== null ? address.port : 0),
      );
    });
  });
}

/** A callback body as the NAS posts it, form-encoded. */
export function callbackForm(fields: Record<string, string>): string {
  return new URLSearchParams({
    token: BOT_TOKEN,
    user_id: "42",
    username: "alice",
    post_id: "1001",
    timestamp: "1700000000000",
    text: "hello bot",
    ...fields,
  }).toString();
}
