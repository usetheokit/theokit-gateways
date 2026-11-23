import type { AdapterCapabilities } from "@theokit/gateway";
import type { AgentOutputEvent } from "@theokit/presenter";

/** Per event kind: `true` shows a progress line, `false` hides it. Wins over the derived tier. */
export interface ProgressOverrides {
  readonly "tool-call"?: boolean;
  readonly reasoning?: boolean;
  readonly status?: boolean;
}

/**
 * A progress function for `AgentHandlerOptions.progress`, chosen from the adapter's capabilities.
 * An adapter that can edit a message (`edit: true`) shows tool calls; one that cannot shows none.
 * Reasoning and status lines are off unless an override turns them on.
 */
export function progressFor(
  capabilities: Pick<AdapterCapabilities, "edit">,
  overrides: ProgressOverrides = {},
): (output: AgentOutputEvent) => string | undefined {
  const on: Shown = {
    "tool-call": capabilities.edit,
    reasoning: false,
    status: false,
    ...overrides,
  };
  return (output) => lineFor(output, on);
}

type Shown = Required<ProgressOverrides>;

function lineFor(output: AgentOutputEvent, on: Shown): string | undefined {
  switch (output.type) {
    case "tool-call":
      return on["tool-call"] ? `Using ${output.name}…` : undefined;
    case "reasoning":
      return on.reasoning ? firstLine(output.text) : undefined;
    case "status":
      return on.status ? firstLine(statusText(output)) : undefined;
    default:
      return undefined;
  }
}

function statusText(output: { status: string; detail?: string }): string {
  return output.detail === undefined ? output.status : `${output.status}: ${output.detail}`;
}

function firstLine(text: string): string | undefined {
  const line = text.trim().split("\n")[0];
  return line === "" ? undefined : line;
}
