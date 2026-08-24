/**
 * `HookExecutor` — runs registered gateway hooks at their fire points.
 *
 * Split out of `hooks/types.ts` (which now holds the contract only) so the
 * filename predicts its contents: interfaces live in `types.ts`, the run
 * engine lives here. Behavior is identical to the previous colocated class.
 *
 * @public
 */

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
export class HookExecutor {
  constructor(private readonly hooks: ReadonlyArray<GatewayHook>) {}

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
