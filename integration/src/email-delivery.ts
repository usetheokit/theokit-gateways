import { waitFor } from "./harness.js";

/** Allow slow external delivery while recording latency for future gate tuning. */
export async function waitForEmail(inbox: string[], marker: string): Promise<string> {
  const started = Date.now();
  try {
    const message = await waitFor(() => inbox.find((line) => line.includes(marker)), {
      timeoutMs: 300_000,
      intervalMs: 2_000,
      label: `an inbound email containing ${marker}`,
    });
    console.info(
      `email inbound ${marker}: observed after ${Date.now() - started}ms since SMTP acceptance`,
    );
    return message;
  } catch (error) {
    throw new Error(
      `email inbound ${marker}: no matching message observed after ${Date.now() - started}ms since SMTP acceptance`,
      { cause: error },
    );
  }
}
