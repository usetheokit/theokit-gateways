/** Small helpers the channel descriptors' `webhook` members share. */

import type { IngestResult } from "../channel/channel-descriptor.js";

/** Reads one request header by lower-case name, whatever case the request used. */
export function webhookHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

/**
 * Maps the HTTP status an adapter's webhook dispatch answered to an `ingest` result: 400 is
 * `"malformed"`, 503 is `"no_handler"`, anything else is `"delivered"`.
 */
export function ingestResultForStatus(status: number): IngestResult {
  if (status === 400) return "malformed";
  return status === 503 ? "no_handler" : "delivered";
}
