import type { GatewayHook, MessageEvent } from "@theokit/gateway";
import { parseChatCommand } from "@theokit/gateway";

/** What an owner answered: allow this call, allow and remember, or refuse. */
export type ApprovalAnswer = "once" | "always" | "deny";

/** Options for {@link createChatApprover}. */
export interface ChatApproverOptions {
  /** The conversation key of an event; must match what the app passes to `ask()`. */
  conversationOf(event: MessageEvent): string;
  isOwner(event: MessageEvent): boolean;
  /** Posts text into the conversation of the last event seen with that key. */
  send(event: MessageEvent, text: string): Promise<void>;
  /** Default 120_000. */
  readonly timeoutMs?: number;
  /** Default: "Run this?\n<question>\nReply /approve, /approve always or /deny within <n> s." */
  format?(question: string, timeoutMs: number): string;
}

/** A chat approver: the gateway hook plus `ask`. */
export interface ChatApprover {
  /** Register with the gateway; answers `/approve`, `/approve always` and `/deny`. */
  readonly hook: GatewayHook;
  /** Asks the conversation and waits. Resolves `deny` on silence, send failure, or no/busy conversation. */
  ask(
    conversation: string,
    question: string,
  ): Promise<{ readonly answer: ApprovalAnswer; readonly by?: string }>;
  /** True while a question is waiting in the event's conversation. */
  hasPending(event: MessageEvent): boolean;
}

type Result = { readonly answer: ApprovalAnswer; readonly by?: string };

interface Pending {
  settle(result: Result): void;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function defaultFormat(question: string, timeoutMs: number): string {
  return `Run this?\n${question}\nReply /approve, /approve always or /deny within ${Math.round(timeoutMs / 1000)} s.`;
}

function answerOf(name: string, arg: string): ApprovalAnswer | undefined {
  if (name === "approve" && arg === "") return "once";
  if (name === "approve" && arg.toLowerCase() === "always") return "always";
  if (name === "deny" && arg === "") return "deny";
  return undefined;
}

/** Asks an owner in chat to approve or deny a tool call; one question per conversation. */
export function createChatApprover(options: ChatApproverOptions): ChatApprover {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const format = options.format ?? defaultFormat;
  const lastEvent = new Map<string, MessageEvent>();
  const pending = new Map<string, Pending>();

  const hook: GatewayHook = {
    name: "chat-approver",
    pre_inbound({ event }) {
      const key = options.conversationOf(event);
      lastEvent.set(key, event);
      const parsed = parseChatCommand(event.text);
      if (!parsed) return undefined;
      const answer = answerOf(parsed.name, parsed.arg);
      if (answer === undefined) return undefined;
      if (!options.isOwner(event)) return { block: true, message: "Only an owner can do that." };
      const entry = pending.get(key);
      if (!entry) return { block: true, message: "Nothing is waiting for approval." };
      entry.settle({ answer, by: `${event.platform}:${event.sender.id}` });
      return { block: true, message: answer === "deny" ? "Denied." : "Approved." };
    },
  };

  function ask(conversation: string, question: string): Promise<Result> {
    const event = lastEvent.get(conversation);
    if (event === undefined || pending.has(conversation)) {
      return Promise.resolve({ answer: "deny" });
    }
    return new Promise<Result>((resolve) => {
      let done = false;
      const entry: Pending = {
        settle(result) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (pending.get(conversation) === entry) pending.delete(conversation);
          resolve(result);
        },
      };
      const timer = setTimeout(() => entry.settle({ answer: "deny" }), timeoutMs);
      timer.unref?.();
      pending.set(conversation, entry);
      let sent: Promise<void>;
      try {
        sent = Promise.resolve(options.send(event, format(question, timeoutMs)));
      } catch {
        entry.settle({ answer: "deny" });
        return;
      }
      sent.catch(() => entry.settle({ answer: "deny" }));
    });
  }

  return {
    hook,
    ask,
    hasPending: (event) => pending.has(options.conversationOf(event)),
  };
}
