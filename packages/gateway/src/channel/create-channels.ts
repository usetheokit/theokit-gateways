/**
 * `createChannels` — build every configured channel from its descriptor (FR-002 of B-018).
 *
 * One loop replaces the per-platform constructor calls an app used to write. A channel whose
 * configuration is refused lands in `rejected` and the others are still built, so one bad entry
 * never stops the healthy ones. Nothing here connects or performs I/O (NFR-001): connecting is the
 * runner's job, after the app has seen what was rejected.
 *
 * @public
 */

import type { BasePlatformAdapter } from "../adapter/base.js";
import { GatewayConfigurationError } from "../errors/config-error.js";
import type { PlatformName } from "../types/message-event.js";
import type { ChannelDescriptor } from "./channel-descriptor.js";

/** One channel to build: its descriptor and the configuration the app supplies for it. */
export interface ChannelEntry {
  readonly descriptor: ChannelDescriptor<BasePlatformAdapter>;
  /** Values keyed by the descriptor's field keys. Absent means every required field is missing. */
  readonly config?: Readonly<Record<string, unknown>>;
}

/** A channel that was not built, and the configuration error that says why. */
export interface ChannelRejection {
  readonly platform: PlatformName;
  readonly error: GatewayConfigurationError;
}

/** What `createChannels` built and what it refused. */
export interface CreateChannelsResult {
  readonly adapters: BasePlatformAdapter[];
  readonly rejected: ChannelRejection[];
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function missingRequiredKeys(
  entry: ChannelEntry,
  values: Readonly<Record<string, unknown>>,
): string[] {
  return entry.descriptor.config
    .filter((field) => field.required && isAbsent(values[field.key]))
    .map((field) => field.key);
}

/**
 * Build an adapter for each entry whose required fields are present.
 *
 * An entry missing a required field (absent, `null` or `""`; `0` and `false` count as present) is
 * rejected with a `GatewayConfigurationError` coded `missing_required_config` that names every
 * missing key, and its `create` is never called. A `GatewayConfigurationError` thrown by `create`
 * is reported the same way. Any other throw is a defect, not a configuration fault, and propagates.
 *
 * @public
 */
export function createChannels(entries: ReadonlyArray<ChannelEntry>): CreateChannelsResult {
  const adapters: BasePlatformAdapter[] = [];
  const rejected: ChannelRejection[] = [];
  for (const entry of entries) {
    const values = entry.config ?? {};
    const platform = entry.descriptor.platform;
    const missing = missingRequiredKeys(entry, values);
    if (missing.length > 0) {
      rejected.push({
        platform,
        error: new GatewayConfigurationError("gateway", {
          code: "missing_required_config",
          message: `channel ${platform}: missing required config ${missing.join(", ")}`,
        }),
      });
      continue;
    }
    try {
      adapters.push(entry.descriptor.create(values));
    } catch (err) {
      if (!(err instanceof GatewayConfigurationError)) throw err;
      rejected.push({ platform, error: err });
    }
  }
  return { adapters, rejected };
}
