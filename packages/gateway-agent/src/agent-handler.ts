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
import type { TurnAgent } from "./run-agent-text.js";
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
  /** The adapter for a platform, used for the ack reaction (e.g. `(p) => runner.adapter(p)`). */
  adapter?(platform: MessageEvent["platform"]): BasePlatformAdapter | undefined;
  /** Called with each progress line; return a line to send, or undefined to skip. Default: none sent. */
  progress?(output: AgentOutputEvent): string | undefined;
  /** Exact values masked out of every reply and progress line. */
  secrets?: ReadonlyArray<string>;
  noAnswerText?: string;
  errorText?: string;
  sendOptions?: Record<string, unknown>;
}

const DEFAULT_NO_ANSWER = "I could not come up with an answer to that.";
const DEFAULT_ERROR = "Something went wrong while answering. Please try again.";
const NO_CODE = "no error code";

interface TurnState {
  text: string;
  failed: boolean;
  code: string | undefined;
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
    await ctx.reply(maskSecrets(message.text, secrets), {
      ...(message.format !== undefined ? { format: message.format } : {}),
    });
  }
}

async function runTurn(
  options: AgentHandlerOptions,
  event: MessageEvent,
  ctx: GatewayContext,
  agent: TurnAgent,
): Promise<TurnState> {
  const state: TurnState = { text: "", failed: false, code: undefined };
  const prompt = options.prompt?.(event) ?? event.text;
  const run = await agent.send(prompt, {
    ...options.sendOptions,
    toolResultGuard: { delimit: true },
  });
  await consume(options, ctx, run.stream(), state);
  const outcome = await run.wait();
  if (outcome.status === "error" || state.failed) {
    state.code = outcome.error?.code ?? state.code;
    state.failed = true;
  }
  return state;
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
    let outcome: { failure?: string; fatal?: unknown };
    try {
      lease = await options.agentFor(event);
      outcome = await answer(options, event, ctx, lease.agent);
    } catch (error) {
      outcome = { failure: error instanceof Error ? error.name : NO_CODE };
    } finally {
      await bestEffort(async () => lease?.release());
    }
    if ("fatal" in outcome) throw outcome.fatal;
    if (outcome.failure === undefined) return;
    await bestEffort(() =>
      replyOnce(ctx, event, nonEmpty(options.errorText, DEFAULT_ERROR), secrets),
    );
    throw new AgentTurnError(event.platform, outcome.failure);
  };
}

/** Runs the turn and sends the answer. A failed turn is returned as a `failure` code, unsent. */
async function answer(
  options: AgentHandlerOptions,
  event: MessageEvent,
  ctx: GatewayContext,
  agent: TurnAgent,
): Promise<{ failure?: string; fatal?: unknown }> {
  await ackReaction(options.adapter?.(event.platform), event, options.ackEmoji);
  const state = await runTurn(options, event, ctx, agent);
  if (state.failed) return { failure: state.code ?? NO_CODE };
  const reply =
    state.text.trim() === "" ? nonEmpty(options.noAnswerText, DEFAULT_NO_ANSWER) : state.text;
  try {
    await replyOnce(ctx, event, reply, options.secrets ?? []);
  } catch (error) {
    return { fatal: error };
  }
  return {};
}
