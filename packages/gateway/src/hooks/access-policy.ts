/**
 * Access policy hook: who may talk to the agent, with sender pairing.
 *
 * @public
 */

import { GatewayConfigurationError } from "../errors/config-error.js";
import { redactSecrets } from "../security/credential-patterns.js";
import type { MessageEvent, PlatformName } from "../types/message-event.js";
import { type PairingStore, senderKey } from "./pairing-store.js";
import type { GatewayHook, HookDecision } from "./types.js";

export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

export interface AccessPolicyOptions {
  /** `<platform>:<senderId>` keys. */
  readonly owners: ReadonlySet<string>;
  readonly allowed?: ReadonlySet<string>;
  readonly dm: DmPolicy;
  /** Group messages from non-members: "silent" (default) or "open". */
  readonly groups?: "silent" | "open";
  /** Which platforms authenticate the sender. */
  readonly isAuthenticated: (platform: PlatformName) => boolean;
  /** Required when dm is "pairing". */
  readonly pairing?: PairingStore;
  readonly refusalText?: string;
  readonly refusalIntervalMs?: number;
  /** Let a message through untouched. */
  readonly passThrough?: (event: MessageEvent) => boolean;
  readonly clock?: () => number;
  readonly write?: (line: string) => void;
}

const SILENT: HookDecision = { block: true };
const DEFAULT_REFUSAL = "Sorry, you are not authorized to use this assistant.";

function normalize(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : senderKey(key.slice(0, i), key.slice(i + 1));
}

function check(keys: ReadonlySet<string>, isAuth: (p: PlatformName) => boolean): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const i = key.indexOf(":");
    const platform = i < 0 ? key : key.slice(0, i);
    if (!isAuth(platform as PlatformName)) {
      throw new GatewayConfigurationError("gateway", {
        code: "unauthenticated_owner",
        message: `gateway: unauthenticated_owner: platform ${platform} does not authenticate the sender`,
        detail: platform,
      });
    }
    out.add(normalize(key));
  }
  return out;
}

/** Builds the `pre_inbound` access policy hook. */
export function createAccessPolicyHook(options: AccessPolicyOptions): GatewayHook {
  if (options.dm === "pairing" && !options.pairing) {
    throw new GatewayConfigurationError("gateway", {
      code: "pairing_store_required",
      message: "gateway: pairing_store_required",
    });
  }
  const owners = check(options.owners, options.isAuthenticated);
  const allowed = check(options.allowed ?? new Set(), options.isAuthenticated);
  const clock = options.clock ?? Date.now;
  const interval = options.refusalIntervalMs ?? 3_600_000;
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const refusal = options.refusalText ?? DEFAULT_REFUSAL;
  const store = options.pairing;
  const refused = new Map<string, number>();

  const mayRefuse = (key: string): boolean => {
    const now = clock();
    for (const [k, t] of refused) if (now - t >= interval) refused.delete(k);
    if (refused.has(key)) return false;
    refused.set(key, now);
    return true;
  };

  const pairingReply = (event: MessageEvent): HookDecision => {
    const code = (store as PairingStore).issue(event.platform, event.sender.id);
    return {
      block: true,
      message: `Your pairing code is ${code}. Ask the owner to send /approve ${code}.`,
    };
  };

  const groupDecision = (): HookDecision | undefined =>
    options.groups === "open" ? undefined : SILENT;

  const stranger = (event: MessageEvent, key: string): HookDecision | undefined => {
    if (event.channel.type !== "dm") return groupDecision();
    if (options.dm === "open") return undefined;
    if (options.dm === "disabled" || !mayRefuse(key)) return SILENT;
    if (options.dm === "allowlist") return { block: true, message: refusal };
    return pairingReply(event);
  };

  const ownerMessage = async (text: string): Promise<HookDecision | undefined> => {
    const m = /^\/approve\s+(\d{6})\s*$/.exec(text.trim());
    if (!m?.[1] || !store) return undefined;
    const r = await store.approve(m[1]);
    return { block: true, message: r.ok ? "Paired." : "Unknown or expired code." };
  };

  const unauthenticated = (event: MessageEvent): HookDecision | undefined =>
    options.dm === "open" && event.channel.type === "dm" ? undefined : SILENT;

  const isPaired = (event: MessageEvent): boolean =>
    store?.isPaired(event.platform, event.sender.id) === true;

  const decide = async (event: MessageEvent): Promise<HookDecision | undefined> => {
    if (options.passThrough?.(event)) return undefined;
    // Never trust or answer a forgeable sender id.
    if (!options.isAuthenticated(event.platform as PlatformName)) return unauthenticated(event);
    const key = senderKey(event.platform, event.sender.id);
    if (owners.has(key)) return ownerMessage(event.text);
    if (allowed.has(key) || isPaired(event)) return undefined;
    return stranger(event, key);
  };

  return {
    name: "access-policy",
    async pre_inbound({ event }) {
      try {
        return await decide(event);
      } catch (e) {
        write(`access-policy: hook failed: ${redactSecrets(e)}`);
        return SILENT;
      }
    },
  };
}
