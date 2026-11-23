import type {
  BasePlatformAdapter,
  GatewayContext,
  GatewayHandler,
  MessageEvent,
} from "@theokit/gateway";
import { channelRendering, maskSecrets } from "@theokit/gateway";
import {
  type AgentOutputEvent,
  ChatPresenter,
  fromSdkMessage,
  type SdkMessage,
} from "@theokit/presenter";

import { AgentTurnError } from "./errors.js";
import type { TurnAgent, TurnRun, TurnUsage } from "./run-agent-text.js";
import { createStreamMasker } from "./stream-mask.js";
import { ackReaction } from "./typing.js";

/**
 * An agent for one event, and how to give it back.
 *
 * @public
 */
export interface AgentLease {
  readonly agent: TurnAgent;
  release(): void | Promise<void>;
}

/**
 * What one turn produced, as seen by `decorateReply` and `onTurnEnd`.
 *
 * @public
 */
export interface TurnOutcome {
  /** The masked reply text; for `onTurnEnd` it is what was sent (decorated, or the fallback text). */
  readonly text: string;
  /** True when the turn errored, was cancelled, or its reply could not be delivered. */
  readonly failed: boolean;
  /** The SDK error code of a failed turn, when there is one. */
  readonly code?: string;
  /** Token usage reported by the run; undefined when the run reports none or never started. */
  readonly usage?: TurnUsage;
}

/**
 * The turn in flight, handed to `onTurnStart` so a second message can reach it.
 *
 * @public
 */
export interface RunningTurn {
  readonly agent: TurnAgent;
  readonly run: TurnRun;
}

/**
 * How `createAgentHandler` finds its agent and what it sends besides the answer.
 *
 * @public
 */
export interface AgentHandlerOptions {
  /** The agent for this event's session (e.g. from SessionRouter + the SDK registry). */
  agentFor(event: MessageEvent): Promise<AgentLease>;
  /** Prompt from the event. Default: event.text. */
  prompt?(event: MessageEvent): string;
  /** React to the inbound message when the turn starts. Typing is the runner's job. */
  ackEmoji?: string;
  /**
   * The runner's adapters. Used to send the ack reaction on `@theokit/gateway` 0.20.x, whose
   * context has no `react`. With neither, the reaction is skipped (logged once) and the turn
   * still replies.
   */
  adapters?: ReadonlyArray<BasePlatformAdapter>;
  /** Called with each progress line; return a line to send, or undefined to skip. Default: none sent. */
  progress?(output: AgentOutputEvent): string | undefined;
  /** Exact values masked out of every reply and progress line. */
  secrets?: ReadonlyArray<string>;
  /**
   * Called with the final masked answer (or `noAnswerText`) of a successful turn; the returned
   * text, masked again, is sent in the same single reply. Throwing sends the undecorated reply.
   */
  decorateReply?(reply: string, outcome: TurnOutcome): string | Promise<string>;
  /**
   * Called once per turn, after the reply attempt, with the final text, `failed` and the usage.
   * Best effort: a throw here never changes the reply or the turn's error.
   */
  onTurnEnd?(event: MessageEvent, outcome: TurnOutcome): void | Promise<void>;
  /**
   * Called when the run has started, so the app can keep it under its own session key
   * (e.g. `router.sessionKey(event)`) and steer or cancel it from a later message. The returned
   * function, if any, runs when the turn ends: unregister there, comparing identity, because a
   * later turn on the same session may have replaced your entry.
   */
  onTurnStart?(event: MessageEvent, turn: RunningTurn): (() => void) | undefined;
  noAnswerText?: string;
  errorText?: string;
  sendOptions?: Record<string, unknown>;
}

const DEFAULT_NO_ANSWER = "I could not come up with an answer to that.";
const DEFAULT_ERROR = "Something went wrong while answering. Please try again.";
const NO_CODE = "no error code";
/** Fixed codes: an exception's own name or message may carry the prompt, so it is never copied. */
const REPLY_REFUSED = "reply_refused";
const UNEXPECTED = "unexpected_error";

interface TurnState {
  text: string;
  failed: boolean;
  code: string | undefined;
  usage: TurnUsage | undefined;
}

/** A configured fallback that renders to nothing would send no reply, so it yields the default. */
function nonEmpty(configured: string | undefined, fallback: string): string {
  return configured === undefined || configured.trim() === "" ? fallback : configured;
}

async function bestEffort(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch {
    /* best effort */
  }
}

async function sendProgress(
  options: AgentHandlerOptions,
  ctx: GatewayContext,
  output: AgentOutputEvent,
): Promise<void> {
  if (options.progress === undefined) return;
  await bestEffort(async () => {
    const line = options.progress?.(output);
    if (line === undefined || line === "") return;
    await ctx.reply(maskSecrets(line, options.secrets ?? []), { format: "plain" });
  });
}

async function consumeOutput(
  options: AgentHandlerOptions,
  ctx: GatewayContext,
  masker: { push(chunk: string): string },
  output: AgentOutputEvent,
  state: TurnState,
): Promise<void> {
  if (output.type === "text") {
    state.text += masker.push(output.text);
  } else if (output.type === "error") {
    if (!state.failed) state.code = output.code;
    state.failed = true;
  } else {
    await sendProgress(options, ctx, output);
  }
}

async function consume(
  options: AgentHandlerOptions,
  ctx: GatewayContext,
  stream: AsyncIterable<{ readonly type: string }>,
  state: TurnState,
): Promise<void> {
  const masker = createStreamMasker(options.secrets ?? []);
  for await (const message of stream) {
    for (const output of fromSdkMessage(message as SdkMessage) as AgentOutputEvent[]) {
      await consumeOutput(options, ctx, masker, output, state);
    }
  }
  state.text += masker.flush();
}

async function replyOnce(
  ctx: GatewayContext,
  event: MessageEvent,
  text: string,
  secrets: ReadonlyArray<string>,
): Promise<void> {
  const presenter = new ChatPresenter({
    channel: event.channel,
    ...channelRendering(event.platform),
  });
  presenter.present({ type: "text", text: maskSecrets(text, secrets) });
  for (const message of presenter.present({ type: "finish" })) {
    const sent = await ctx.reply(maskSecrets(message.text, secrets), {
      ...(message.format !== undefined ? { format: message.format } : {}),
    });
    if (sent?.ok === false) throw new AgentTurnError(event.platform, REPLY_REFUSED);
  }
}

async function runTurn(
  options: AgentHandlerOptions,
  event: MessageEvent,
  ctx: GatewayContext,
  agent: TurnAgent,
): Promise<TurnState> {
  const state: TurnState = { text: "", failed: false, code: undefined, usage: undefined };
  const prompt = options.prompt?.(event) ?? event.text;
  const run = await agent.send(prompt, {
    ...options.sendOptions,
    toolResultGuard: { delimit: true },
  });
  let unregister: (() => void) | undefined;
  try {
    unregister = options.onTurnStart?.(event, { agent, run });
  } catch {
    unregister = undefined;
  }
  try {
    await consume(options, ctx, run.stream(), state);
    const outcome = await run.wait();
    state.usage = outcome.usage;
    if (outcome.status === "error" || outcome.status === "cancelled" || state.failed) {
      state.code = outcome.error?.code ?? state.code;
      state.failed = true;
    }
  } finally {
    await bestEffort(async () => unregister?.());
  }
  return state;
}

interface HandlerResult {
  failure?: string;
  fatal?: unknown;
  text?: string;
  usage?: TurnUsage;
}

/**
 * Turns an SDK agent into a `GatewayHandler`: one agent turn per message, exactly one reply
 * (the answer, `noAnswerText` when empty, or `errorText` when the turn failed), after which a
 * failed turn throws `AgentTurnError` so the runner fires `on_error`. The lease is always
 * released. The handler starts no typing indicator; `GatewayRunner` does.
 *
 * @public
 */
export function createAgentHandler(options: AgentHandlerOptions): GatewayHandler {
  const secrets = options.secrets ?? [];
  return async (event, ctx) => {
    let lease: AgentLease | undefined;
    let outcome: HandlerResult;
    try {
      lease = await options.agentFor(event);
      outcome = await answer(options, event, ctx, lease.agent);
    } catch (_error) {
      outcome = { failure: UNEXPECTED };
    } finally {
      await bestEffort(async () => lease?.release());
    }
    let errorSent: string | undefined;
    if (outcome.fatal === undefined && outcome.failure !== undefined) {
      const text = nonEmpty(options.errorText, DEFAULT_ERROR);
      errorSent = text;
      await bestEffort(() => replyOnce(ctx, event, text, secrets));
    }
    await endTurn(options, event, outcome, errorSent);
    if ("fatal" in outcome) throw outcome.fatal;
    if (outcome.failure === undefined) return;
    throw new AgentTurnError(event.platform, outcome.failure);
  };
}

/** Reports the turn once; a throwing hook never changes the reply or the error. */
async function endTurn(
  options: AgentHandlerOptions,
  event: MessageEvent,
  result: HandlerResult,
  errorSent: string | undefined,
): Promise<void> {
  const { failure, usage } = result;
  const outcome: TurnOutcome = {
    text: maskSecrets(errorSent ?? result.text ?? "", options.secrets ?? []),
    failed: "fatal" in result || failure !== undefined,
    ...(failure !== undefined && failure !== UNEXPECTED ? { code: failure } : {}),
    ...(usage !== undefined ? { usage } : {}),
  };
  await bestEffort(async () => options.onTurnEnd?.(event, outcome));
}

/** The reply text after `decorateReply`; a throw or an empty result keeps the original. */
async function decorate(
  options: AgentHandlerOptions,
  reply: string,
  usage: TurnUsage | undefined,
): Promise<string> {
  if (options.decorateReply === undefined) return reply;
  try {
    const decorated = await options.decorateReply(reply, {
      text: reply,
      failed: false,
      ...(usage !== undefined ? { usage } : {}),
    });
    return typeof decorated === "string" && decorated.trim() !== "" ? decorated : reply;
  } catch {
    return reply;
  }
}

/** Runs the turn and sends the answer. A failed turn is returned as a `failure` code, unsent. */
async function answer(
  options: AgentHandlerOptions,
  event: MessageEvent,
  ctx: GatewayContext,
  agent: TurnAgent,
): Promise<HandlerResult> {
  await ackReaction(ctx, event, options.ackEmoji, options.adapters);
  const state = await runTurn(options, event, ctx, agent);
  const { usage } = state;
  const base = usage !== undefined ? { usage } : {};
  if (state.failed) return { failure: state.code ?? NO_CODE, text: state.text, ...base };
  const answered =
    state.text.trim() === "" ? nonEmpty(options.noAnswerText, DEFAULT_NO_ANSWER) : state.text;
  const reply = await decorate(options, answered, usage);
  try {
    await replyOnce(ctx, event, reply, options.secrets ?? []);
  } catch (error) {
    return { fatal: error, text: reply, ...base };
  }
  return { text: reply, ...base };
}
