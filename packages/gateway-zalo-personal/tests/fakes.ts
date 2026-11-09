import type { ZaloApi, ZaloListenerMessage } from "../src/index.js";

/** A scripted `zca-js` API: records sends and lets a test push listener events. */
export class FakeZaloApi implements ZaloApi {
  readonly sent: { msg: string; threadId: string; type: number }[] = [];
  started = 0;
  stopped = 0;
  failSend: Error | undefined;
  private readonly handlers = new Map<string, (...args: never[]) => void>();

  readonly listener = {
    on: ((event: string, handler: (...args: never[]) => void) => {
      this.handlers.set(event, handler);
    }) as ZaloApi["listener"]["on"],
    start: () => {
      this.started += 1;
    },
    stop: () => {
      this.stopped += 1;
    },
  };

  async sendMessage(message: { msg: string }, threadId: string, type: number) {
    if (this.failSend) throw this.failSend;
    this.sent.push({ msg: message.msg, threadId, type });
    return { message: { msgId: 9000 + this.sent.length } };
  }

  emit(message: ZaloListenerMessage): void {
    (this.handlers.get("message") as ((m: ZaloListenerMessage) => void) | undefined)?.(message);
  }

  close(code: number, reason: string): void {
    (this.handlers.get("closed") as ((c: number, r: string) => void) | undefined)?.(code, reason);
  }
}

export const CREDENTIALS = { cookie: [], imei: "imei-1", userAgent: "ua" } as const;

export function text(
  content: unknown,
  extra: Partial<ZaloListenerMessage> & { msgId?: unknown } = {},
): ZaloListenerMessage {
  const { msgId, ...rest } = extra;
  return {
    type: 0,
    threadId: "peer-1",
    data: { msgId: msgId ?? "m1", uidFrom: "peer-1", dName: "Linh", content },
    ...rest,
  };
}
