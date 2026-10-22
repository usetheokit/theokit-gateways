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

/** An entry that was refused, and the rejection that says why. */
interface Refused {
  readonly adapter?: undefined;
  readonly refusal: ChannelRejection;
}

/** What building one entry produced: its adapter, or the rejection that refused it. */
type BuildOutcome =
  | { readonly adapter: BasePlatformAdapter; readonly refusal?: undefined }
  | Refused;

function refused(platform: PlatformName, code: string, reason: string): Refused {
  return {
    refusal: {
      platform,
      error: new GatewayConfigurationError("gateway", {
        code,
        message: `channel ${platform}: ${reason}`,
      }),
    },
  };
}

/**
 * The rejection an entry gets before its `create` runs, or `undefined` when it may be built. A
 * repeated platform is checked first: the platform is already served, so its config is moot.
 */
function refuseBeforeCreate(
  entry: ChannelEntry,
  values: Readonly<Record<string, unknown>>,
  builtPlatforms: ReadonlySet<PlatformName>,
): Refused | undefined {
  const platform = entry.descriptor.platform;
  if (builtPlatforms.has(platform)) {
    return refused(platform, "duplicate_channel", "a channel for this platform was already built");
  }
  const missing = missingRequiredKeys(entry, values);
  if (missing.length > 0) {
    return refused(
      platform,
      "missing_required_config",
      `missing required config ${missing.join(", ")}`,
    );
  }
  return undefined;
}

/**
 * Call the descriptor's `create` and check what it built. The runner keys adapters by the
 * adapter's own `platform`, and the duplicate check keys them by the descriptor's, so an adapter
 * reporting another platform than its descriptor is refused: kept, it would reach the runner as a
 * second adapter for a platform the duplicate check never saw.
 */
function createAdapter(
  entry: ChannelEntry,
  values: Readonly<Record<string, unknown>>,
): BuildOutcome {
  const platform = entry.descriptor.platform;
  let adapter: BasePlatformAdapter;
  try {
    adapter = entry.descriptor.create(values);
  } catch (err) {
    if (!(err instanceof GatewayConfigurationError)) throw err;
    return { refusal: { platform, error: err } };
  }
  if (adapter.platform !== platform) {
    return refused(
      platform,
      "platform_mismatch",
      `create returned an adapter reporting platform ${adapter.platform}`,
    );
  }
  return { adapter };
}

/**
 * Build an adapter for each entry whose required fields are present.
 *
 * An entry missing a required field (absent, `null` or `""`; `0` and `false` count as present) is
 * rejected with a `GatewayConfigurationError` coded `missing_required_config` that names every
 * missing key, and its `create` is never called. A `GatewayConfigurationError` thrown by `create`
 * is reported the same way. Any other throw is a defect, not a configuration fault, and propagates.
 *
 * Only one adapter per platform is built, because the runner routes replies and `stop()` by
 * platform. The first entry built for a platform wins; a later entry for that platform is rejected
 * with a `GatewayConfigurationError` coded `duplicate_channel`, before its required fields are
 * checked, and its `create` is never called. An entry rejected for its configuration built
 * nothing, so it does not claim its platform.
 *
 * The runner keys adapters by the adapter's own `platform`, so an adapter must report the platform
 * its descriptor declares. One that reports another is discarded unconnected and its entry is
 * rejected with a `GatewayConfigurationError` coded `platform_mismatch`; it claims no platform.
 *
 * @public
 */
export function createChannels(entries: ReadonlyArray<ChannelEntry>): CreateChannelsResult {
  const adapters: BasePlatformAdapter[] = [];
  const rejected: ChannelRejection[] = [];
  const builtPlatforms = new Set<PlatformName>();
  for (const entry of entries) {
    const values = entry.config ?? {};
    const outcome =
      refuseBeforeCreate(entry, values, builtPlatforms) ?? createAdapter(entry, values);
    if (outcome.refusal !== undefined) {
      rejected.push(outcome.refusal);
      continue;
    }
    adapters.push(outcome.adapter);
    builtPlatforms.add(entry.descriptor.platform);
  }
  return { adapters, rejected };
}
