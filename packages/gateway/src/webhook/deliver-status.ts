/** The outcome of delivering one event to the runner's handlers. */
type DeliverOutcome = "ok" | "no_handler" | "handler_threw";

/**
 * Map the outcomes of one delivered batch to an HTTP status, worst wins: `handler_threw` is 500,
 * `no_handler` is 503 so the provider retries, `ok` and an empty batch are 200. An unknown outcome
 * throws instead of answering 200.
 */
export function statusForDeliver(outcomes: ReadonlyArray<DeliverOutcome>): 200 | 500 | 503 {
  let status: 200 | 500 | 503 = 200;
  for (const outcome of outcomes as ReadonlyArray<string>) {
    if (outcome === "handler_threw") {
      status = 500;
    } else if (outcome === "no_handler") {
      if (status === 200) status = 503;
    } else if (outcome !== "ok") {
      throw new Error(`unknown deliver outcome: ${outcome}`);
    }
  }
  return status;
}
