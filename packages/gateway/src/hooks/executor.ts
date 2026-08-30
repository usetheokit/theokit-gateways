/**
 * `HookExecutor` — runs registered gateway hooks at their fire points.
 *
 * Split out of `hooks/types.ts` (which now holds the contract only) so the
 * filename predicts its contents: interfaces live in `types.ts`, the run
 * engine lives here. Behavior is identical to the previous colocated class.
 *
 * @public
 */

import { GatewayConfigurationError } from "../errors/config-error.js";
import { redactSecrets } from "../security/credential-patterns.js";

import type {
  GatewayHook,
  HookDecision,
  OnErrorContext,
  PostOutboundContext,
  PreInboundContext,
} from "./types.js";

/**
 * Runs registered hooks at the right fire points. Stateless — safe to
 * construct per-event if hooks need event-scoped storage.
 *
 * @public
 */
const HOOK_PHASES = ["pre_inbound", "post_outbound", "on_error"] as const;

/** Refusal for one bad entry in a hook list, naming WHICH entry (#80). */
function malformedHook(index: number, why: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway", {
    code: "malformed_hook",
    message: `gateway: hooks[${index}] ${why}`,
    detail: `hooks[${index}]`,
  });
}

/**
 * Refuse one hook-list entry that is not a hook (#80).
 *
 * Every fire point below asks `if (h.<phase> === undefined) continue`, which cannot tell "this hook
 * does not implement this phase" from "this is not a hook". So an entry that failed to resolve in a
 * config-driven list used to be skipped in silence, and the gateway started with the rate limiter,
 * audit trail or error reporter its operator believed they had wired simply absent. A missing
 * security hook that says nothing is worse than a loud failure, because the deployment looks
 * correct.
 */
function assertHook(entry: unknown, index: number): void {
  if (typeof entry !== "object" || entry === null) {
    throw malformedHook(index, `is ${entry === null ? "null" : typeof entry}, not a hook object`);
  }
  const hook = entry as Partial<GatewayHook>;
  if (typeof hook.name !== "string" || hook.name.length === 0) {
    throw malformedHook(
      index,
      "has no name — every hook is named so a log can say which one acted",
    );
  }
  const declared = HOOK_PHASES.filter((phase) => hook[phase] !== undefined);
  if (declared.length === 0) {
    throw malformedHook(
      index,
      `("${hook.name}") declares none of ${HOOK_PHASES.join(", ")} — it would never run`,
    );
  }
  for (const phase of declared) {
    if (typeof hook[phase] !== "function") {
      throw malformedHook(index, `("${hook.name}") declares ${phase}, which is not callable`);
    }
  }
}

export class HookExecutor {
  constructor(private readonly hooks: ReadonlyArray<GatewayHook>) {
    // The arguments are named rather than inherited from `forEach`, which passes three. Today
    // `assertHook` takes two and the array is discarded harmlessly; the day it grows a third
    // parameter it would silently receive the whole array instead of whatever was intended.
    hooks.forEach((hook, index) => {
      assertHook(hook, index);
    });
  }

  /**
   * Fire `pre_inbound` hooks sequentially. First `{ block: true }` short-circuits.
   * A hook throwing is treated as `{ block: true }` (logged via the runner).
   */
  async firePreInbound(ctx: PreInboundContext): Promise<HookDecision> {
    for (const h of this.hooks) {
      if (h.pre_inbound === undefined) continue;
      // biome-ignore lint/suspicious/noConfusingVoidType: hook may return void (no decision) or a HookDecision.
      let decision: HookDecision | void;
      try {
        decision = await h.pre_inbound(ctx);
      } catch (err) {
        // `GatewayRunner.dispatch` replies with this message straight into the
        // chat, so it must never carry the exception text. It used to:
        // `hook ${h.name} threw: ${err.message}` sent whatever the hook happened
        // to throw — connection strings, internal ids, bearer tokens — to the end
        // user verbatim. The sibling handler path already logs through
        // `redactSecrets` (EC-F); this one skipped redaction entirely, and the
        // test asserting the raw text appeared locked the leak in as expected
        // behaviour.
        //
        // The detail is not lost, only moved: stderr gets it, redacted.
        process.stderr.write(
          `[gateway] pre_inbound hook "${h.name}" threw: ${redactSecrets((err as Error).message)}\n`,
        );
        return {
          block: true,
          message: `Request blocked: hook "${h.name}" failed.`,
        };
      }
      if (decision !== undefined && decision.block === true) {
        return decision;
      }
    }
    return { block: false };
  }

  /** Fire all `post_outbound` hooks; errors logged via stderr. */
  async firePostOutbound(ctx: PostOutboundContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.post_outbound === undefined) continue;
      try {
        await h.post_outbound(ctx);
      } catch (err) {
        process.stderr.write(
          `[gateway] post_outbound hook "${h.name}" threw: ${(err as Error).message}\n`,
        );
      }
    }
  }

  /** Fire all `on_error` hooks; errors logged via stderr. */
  async fireOnError(ctx: OnErrorContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.on_error === undefined) continue;
      try {
        await h.on_error(ctx);
      } catch (err) {
        process.stderr.write(
          `[gateway] on_error hook "${h.name}" threw: ${(err as Error).message}\n`,
        );
      }
    }
  }
}
