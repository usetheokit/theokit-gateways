import type { BuzzSocket } from "../src/index.js";

type Listener = (event: never) => void;

/** A scripted socket: a test opens, pushes frames and closes it. */
export class FakeSocket implements BuzzSocket {
  closed = 0;
  private readonly listeners = new Map<string, Listener>();
  constructor(
    readonly url: string,
    readonly headers: Readonly<Record<string, string>>,
  ) {}
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed += 1;
  }
  open(): void {
    (this.listeners.get("open") as () => void)();
  }
  frame(value: unknown): void {
    (this.listeners.get("message") as (e: { data: unknown }) => void)({
      data: typeof value === "string" ? value : JSON.stringify(value),
    });
  }
  drop(code = 1006, reason = "gone"): void {
    (this.listeners.get("close") as (e: unknown) => void)({ code, reason });
  }
}

export interface Call {
  url: string;
  headers: Record<string, string>;
  body: { body: string; nonce: string };
}

/** A fake `fetch` that records posts and answers a numbered id, or a scripted status. */
export function fakeFetch(status = 200) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    return new Response(status === 200 ? JSON.stringify({ id: `sent-${calls.length}` }) : "no", {
      status,
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

export function message(over: Record<string, unknown> = {}, cursor = "5") {
  return {
    type: "message.created",
    cursor,
    payload: {
      message: {
        id: "m1",
        channel_id: "ch1",
        workspace_id: "w1",
        author_user_id: "u1",
        author_name: "Ana",
        body: "hello",
        ...over,
      },
    },
  };
}
