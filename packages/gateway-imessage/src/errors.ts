/**
 * `imsg` send errors → `SendResult`, keeping what each one says about the message.
 *
 * The codes and the `data` shape are `imsg`'s own (its `docs/rpc.md` at `e07f914`, relayed by the
 * B-355 discovery). None of them is retried here: an uncertain send may already be on the
 * recipient's phone, and only the caller can decide whether a second copy is acceptable.
 *
 * @internal
 */

import type { SendResult } from "@theokit/gateway";

/** The send may have completed; its receipt is missing. */
const OUTCOME_UNCERTAIN = -32001;
/** The send lane is blocked after an earlier send stayed in flight; only a new child clears it. */
const SEND_LANE_BLOCKED = -32004;

/** What the adapter must do after an error, beyond returning its result. */
export interface MappedSendError {
  readonly result: SendResult;
  /** True when the child can no longer send and must be ended. */
  readonly endChild: boolean;
}

/** Map one JSON-RPC error of a `send` request. */
export function mapSendError(code: number, message: string, data: unknown): MappedSendError {
  // A blocked lane comes first whatever its data says: the child must end either way.
  if (code === SEND_LANE_BLOCKED) {
    return { result: failure("imsg_send_lane_blocked", message), endChild: true };
  }
  if (wasNotStarted(data)) return refused("imsg_not_sent", message);
  if (code === OUTCOME_UNCERTAIN) return refused("imsg_outcome_uncertain", message);
  return refused("imsg_error", message);
}

/** `data: { state: "not_started", retry_safe: true }`: nothing was sent, so a retry is safe. */
function wasNotStarted(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const fields = data as { state?: unknown; retry_safe?: unknown };
  return fields.state === "not_started" && fields.retry_safe === true;
}

function refused(code: string, message: string): MappedSendError {
  return { result: failure(code, message), endChild: false };
}

function failure(code: string, message: string): SendResult {
  return { ok: false, error: { code, message } };
}
