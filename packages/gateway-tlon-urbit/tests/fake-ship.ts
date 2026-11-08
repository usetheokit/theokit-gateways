/**
 * A scripted Urbit ship for the Tlon tests: `/~/login`, the channel `PUT`s and the `GET` event
 * stream, with controls for the ship's side. Frame shapes follow OpenClaw's Tlon extension at
 * `abd280635b` (`extensions/tlon/src/urbit/sse-client.ts`, `send.ts`, `monitor/index.ts`).
 */

import type { FetchLike } from "../src/types.js";

/** One action the client sent in a channel `PUT`. */
export interface ChannelAction {
  readonly id?: number;
  readonly action: string;
  readonly ship?: string;
  readonly app?: string;
  readonly mark?: string;
  readonly path?: string;
  readonly json?: unknown;
  readonly "event-id"?: number;
}

interface Channel {
  readonly id: string;
  readonly pending: string[];
  controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  nextEventId: number;
}

const encoder = new TextEncoder();

export class FakeShip {
  readonly url = "https://ship.example";
  readonly logins: string[] = [];
  readonly gets: string[] = [];
  readonly actions: Array<{ channel: string; action: ChannelAction }> = [];
  /** Answers the next login; a status of 401 or 403 refuses it. */
  login: () => Promise<Response> = async () =>
    new Response(null, {
      status: 204,
      headers: { "set-cookie": "urbauth-~bot=0v1.abcde; Path=/" },
    });
  /** The status a channel `GET` answers with. */
  getStatus: (channel: string) => number = () => 200;
  /** How a poke is answered: an `ok` frame, an `err` frame, or nothing. */
  pokeAnswer: "ok" | "err" | "none" = "ok";
  private readonly channels = new Map<string, Channel>();
  private latest: Channel | undefined;

  readonly fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = String(init.body ?? "");
    if (url.pathname === "/~/login") return this.onLogin(body);
    const id = /^\/~\/channel\/(.+)$/.exec(url.pathname)?.[1];
    if (id === undefined) return new Response(null, { status: 404 });
    const channel = this.channel(id);
    return init.method === "PUT" ? this.onPut(channel, body) : this.onGet(channel, init.signal);
  };

  private onLogin(body: string): Promise<Response> {
    this.logins.push(body);
    return this.login();
  }

  private onGet(channel: Channel, signal: AbortSignal | null | undefined): Promise<Response> {
    this.gets.push(channel.id);
    if (this.hangGets) return new Promise(() => undefined);
    const status = this.getStatus(channel.id);
    if (status !== 200) return Promise.resolve(new Response(null, { status }));
    return Promise.resolve(this.openStream(channel, signal));
  }

  /** The ship pushes one `/v3` fact on the latest channel, for subscription `subscriptionId`. */
  fact(json: unknown, subscriptionId = this.subscriptionId()): void {
    this.frame(this.current(), { id: subscriptionId, response: "diff", json });
  }

  /** Whether a channel `GET` hangs without answering. */
  hangGets = false;

  /** The ship ends the chat subscription on the latest channel. */
  quit(subscriptionId = this.subscriptionId()): void {
    this.frame(this.current(), { id: subscriptionId, response: "quit" });
  }

  /** The ship ends the latest stream. */
  endStream(): void {
    const channel = this.current();
    channel.controller?.close();
    channel.controller = undefined;
  }

  /** The `event-id`s the client acknowledged, in order. */
  acks(): number[] {
    return this.actions
      .filter(({ action }) => action.action === "ack")
      .map(({ action }) => action["event-id"] ?? -1);
  }

  /** The pokes the client sent. */
  pokes(): ChannelAction[] {
    return this.actions
      .filter(({ action }) => action.action === "poke")
      .map(({ action }) => action);
  }

  /** The subscriptions the client sent, with the channel each went to. */
  subscriptions(): Array<{ channel: string; action: ChannelAction }> {
    return this.actions.filter(({ action }) => action.action === "subscribe");
  }

  /** The id of the most recent chat subscription. */
  subscriptionId(): number {
    return this.subscriptions().at(-1)?.action.id ?? 1;
  }

  private channel(id: string): Channel {
    let channel = this.channels.get(id);
    if (channel === undefined) {
      channel = { id, pending: [], controller: undefined, nextEventId: 1 };
      this.channels.set(id, channel);
    }
    this.latest = channel;
    return channel;
  }

  private current(): Channel {
    if (this.latest === undefined) throw new Error("no channel was opened");
    return this.latest;
  }

  private onPut(channel: Channel, body: string): Response {
    for (const action of JSON.parse(body) as ChannelAction[]) {
      this.actions.push({ channel: channel.id, action });
      if (action.action === "subscribe") {
        this.frame(channel, { id: action.id, response: "subscribe", ok: "ok" });
      }
      if (action.action === "poke" && this.pokeAnswer !== "none") {
        this.frame(
          channel,
          this.pokeAnswer === "ok"
            ? { id: action.id, response: "poke", ok: "ok" }
            : { id: action.id, response: "poke", err: "poke crashed" },
        );
      }
    }
    return new Response(null, { status: 204 });
  }

  private frame(channel: Channel, payload: unknown): void {
    const text = `id: ${channel.nextEventId}\ndata: ${JSON.stringify(payload)}\n\n`;
    channel.nextEventId += 1;
    if (channel.controller === undefined) channel.pending.push(text);
    else channel.controller.enqueue(encoder.encode(text));
  }

  private openStream(channel: Channel, signal: AbortSignal | null | undefined): Response {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        channel.controller = controller;
        for (const text of channel.pending.splice(0)) controller.enqueue(encoder.encode(text));
        signal?.addEventListener("abort", () => {
          if (channel.controller === controller) channel.controller = undefined;
          try {
            controller.error(signal.reason);
          } catch {
            // Already closed by the ship's side.
          }
        });
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
}

/** A DM essay fact as `/v3` sends it (OpenClaw `monitor/index.ts` lines 903 to 925). */
export function essayFact(opts: {
  from: string;
  id: string;
  text: string;
  author?: string;
}): unknown {
  return {
    whom: opts.from,
    id: opts.id,
    response: {
      add: {
        essay: {
          author: opts.author ?? opts.from,
          sent: 1_700_000_000_000,
          content: [{ inline: [opts.text] }],
        },
      },
    },
  };
}
