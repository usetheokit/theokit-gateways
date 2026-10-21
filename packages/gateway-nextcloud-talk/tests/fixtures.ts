/**
 * Local stand-ins for a Nextcloud server: the webhook bodies the Q6 probe received (2026-10-21,
 * nextcloud:31-apache, spreed 21.1.11; the room token and ids belong to a container since
 * removed), a signer that signs the way Talk does, and a scripted `fetch` that answers the
 * capabilities read and the bot message endpoint. Nothing leaves the process.
 */

import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:net";

import type { FetchLike } from "../src/index.js";

export const BASE_URL = "https://cloud.example.com";
export const SECRET = "a-bot-secret-of-forty-or-more-characters-0123456789";
export const ROOM = "uau7bvcd";
export const CAPABILITIES_URL = `${BASE_URL}/ocs/v2.php/cloud/capabilities?format=json`;
export const BOT_MESSAGE_URL = `${BASE_URL}/ocs/v2.php/apps/spreed/api/v1/bot/${ROOM}/message`;

/** The bot joining the room: Talk posts it to the webhook too. */
export const JOIN_BODY = {
  type: "Join",
  actor: {
    type: "Application",
    id: "bots/bot-9bbf574dcec6089a3c825995fdfad4dd1d5e652c",
    name: "b358-probe",
  },
  object: { type: "Collection", id: ROOM, name: "b358" },
};

/** A user's message. */
export const CREATE_BODY = {
  type: "Create",
  actor: { type: "Person", id: "users/admin", name: "admin", talkParticipantType: "1" },
  object: {
    type: "Note",
    id: "2",
    name: "message",
    content: '{"message":"hello **bold** from B-358","parameters":[]}',
    mediaType: "text/markdown",
  },
  target: { type: "Collection", id: ROOM, name: "b358" },
};

/** A user's reply to message 2. */
export const REPLY_BODY = {
  type: "Create",
  actor: { type: "Person", id: "users/admin", name: "admin", talkParticipantType: "1" },
  object: {
    type: "Note",
    id: "6",
    name: "message",
    content: '{"message":"user answer","parameters":[]}',
    mediaType: "text/markdown",
    inReplyTo: {
      type: "Note",
      actor: { type: "Person", id: "users/admin", name: "admin" },
      object: {
        type: "Note",
        id: "2",
        name: "message",
        content: '{"message":"hello **bold** from B-358","parameters":[]}',
        mediaType: "text/markdown",
      },
    },
  },
  target: { type: "Collection", id: ROOM, name: "b358" },
};

/** Hex HMAC-SHA256 of `random + payload` under `secret`: how Talk signs both directions. */
export function talkSignature(random: string, payload: string, secret = SECRET): string {
  return createHmac("sha256", secret)
    .update(random + payload)
    .digest("hex");
}

/** A fresh 64-hex random, the length Talk sends. */
export function freshRandom(): string {
  return randomBytes(32).toString("hex");
}

/** The headers Talk sends with `rawBody`, signed over random plus body. */
export function signedHeaders(rawBody: string): { random: string; signature: string } {
  const random = freshRandom();
  return { random, signature: talkSignature(random, rawBody) };
}

/** A capabilities answer, with `bots-v1` unless told otherwise. */
export function capabilities(features: readonly string[] = ["chat-v2", "bots-v1"]): unknown {
  return {
    ocs: {
      meta: { status: "ok", statuscode: 200 },
      data: {
        capabilities: {
          spreed: { features, config: { chat: { "max-length": 32000 } } },
        },
      },
    },
  };
}

/** One request the scripted server received on the bot message endpoint. */
export interface BotSend {
  readonly url: string;
  readonly headers: Headers;
  readonly body: { message: string; referenceId: string; replyTo?: number };
}

/** What the scripted server saw, and how it answers. */
export interface ScriptedTalk {
  readonly fetch: FetchLike;
  readonly sends: BotSend[];
  capabilityReads: number;
  /** The capabilities to serve; `undefined` answers 404. */
  capabilities: unknown;
  /** Never answer the capabilities read (only an abort ends it). */
  capabilitiesHang: boolean;
  /** The signal the last capabilities read carried. */
  lastCapabilitiesSignal: AbortSignal | undefined;
  /** Answer bot messages with this status. */
  sendStatus: number;
  /** When set, the status for the send at this 0-based index, in place of `sendStatus`. */
  sendStatusFor: ((index: number) => number) | undefined;
}

export function scriptedTalk(): ScriptedTalk {
  const talk: ScriptedTalk = {
    sends: [],
    capabilityReads: 0,
    capabilities: capabilities(),
    capabilitiesHang: false,
    lastCapabilitiesSignal: undefined,
    sendStatus: 201,
    sendStatusFor: undefined,
    fetch: async (input, init) => {
      if (input === CAPABILITIES_URL) return capabilitiesAnswer(talk, init);
      if (input.startsWith(`${BASE_URL}/ocs/v2.php/apps/spreed/api/v1/bot/`)) {
        return sendAnswer(talk, input, init);
      }
      throw new Error(`unexpected fetch to ${input}`);
    },
  };
  return talk;
}

function capabilitiesAnswer(talk: ScriptedTalk, init: RequestInit | undefined): Promise<Response> {
  talk.capabilityReads += 1;
  talk.lastCapabilitiesSignal = init?.signal ?? undefined;
  if (talk.capabilitiesHang) return hangUntilAborted(init?.signal);
  if (talk.capabilities === undefined) return Promise.resolve(new Response("", { status: 404 }));
  return Promise.resolve(Response.json(talk.capabilities));
}

function sendAnswer(talk: ScriptedTalk, url: string, init: RequestInit | undefined): Response {
  const body = JSON.parse(String(init?.body)) as BotSend["body"];
  const status = talk.sendStatusFor?.(talk.sends.length) ?? talk.sendStatus;
  talk.sends.push({ url, headers: new Headers(init?.headers), body });
  return Response.json({ ocs: { meta: { statuscode: status }, data: [] } }, { status });
}

function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
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
