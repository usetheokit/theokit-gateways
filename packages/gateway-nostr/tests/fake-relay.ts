/**
 * Scripted relays for the relay-client and adapter tests: each socket records what the client sent
 * and lets the test play the relay's side of the conversation.
 */

import type { NostrSocket } from "../src/relay-client.js";

/** One relay connection: what the client sent, and controls for the relay's side. */
export class FakeSocket implements NostrSocket {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: unknown[][] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown[]);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** The relay accepts the connection. */
  accept(): void {
    this.onopen?.();
  }

  /** The relay refuses the connection, as a failed handshake does. */
  refuse(): void {
    this.onerror?.();
    this.drop();
  }

  /** The connection drops from the relay's side. */
  drop(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** The relay sends one message. */
  push(message: readonly unknown[]): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** The frames of one type the client sent, in order. */
  frames(type: string): unknown[][] {
    return this.sent.filter((frame) => frame[0] === type);
  }
}

/** Every socket the client opened, by relay URL, in order. */
export class FakeRelays {
  readonly sockets: FakeSocket[] = [];

  readonly factory = (url: string): FakeSocket => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    return socket;
  };

  /** The most recent socket opened to `url`. */
  latest(url: string): FakeSocket {
    const found = this.sockets.filter((socket) => socket.url === url).at(-1);
    if (found === undefined) throw new Error(`no socket was opened to ${url}`);
    return found;
  }

  /** Every socket opened to `url`. */
  opened(url: string): FakeSocket[] {
    return this.sockets.filter((socket) => socket.url === url);
  }
}
