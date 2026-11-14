import { type AgentOutputEvent, fromSdkMessage, type SdkMessage } from "@theokit/presenter";

/**
 * The part of an SDK Agent this package uses, so tests can pass a fake.
 *
 * @public
 */
export interface TurnAgent {
  send(
    prompt: string,
    options?: Record<string, unknown>,
  ): Promise<{
    stream(): AsyncIterable<{ readonly type: string }>;
    wait(): Promise<{ status: string; error?: { code?: string } }>;
  }>;
}

/**
 * What one turn produced: the text, and on failure a short code (never a message).
 *
 * @public
 */
export type AgentTextResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly text: string; readonly failure: string };

const NO_CODE = "no error code";

async function collect(stream: AsyncIterable<{ readonly type: string }>): Promise<{
  text: string;
  streamFailed: boolean;
  streamCode: string | undefined;
}> {
  let text = "";
  let streamFailed = false;
  let streamCode: string | undefined;
  for await (const message of stream) {
    for (const event of fromSdkMessage(message as SdkMessage) as AgentOutputEvent[]) {
      if (event.type === "text") text += event.text;
      else if (event.type === "error" && !streamFailed) {
        streamFailed = true;
        streamCode = event.code;
      }
    }
  }
  return { text, streamFailed, streamCode };
}

/**
 * Runs one turn with tool results framed as untrusted data (`toolResultGuard.delimit`, merged
 * over the caller's `sendOptions`). The turn failed when `wait()` reports `status: "error"` or the
 * stream carried an error, even if `wait()` says it finished.
 *
 * @public
 */
export async function runAgentText(
  agent: TurnAgent,
  prompt: string,
  options: { sendOptions?: Record<string, unknown> } = {},
): Promise<AgentTextResult> {
  const run = await agent.send(prompt, {
    ...options.sendOptions,
    toolResultGuard: { delimit: true },
  });
  const { text, streamFailed, streamCode } = await collect(run.stream());
  const outcome = await run.wait();
  if (outcome.status === "error" || streamFailed) {
    return {
      ok: false,
      text,
      failure: outcome.error?.code ?? streamCode ?? NO_CODE,
    };
  }
  return { ok: true, text };
}
