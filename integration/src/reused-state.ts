/**
 * Recognising a bootstrap that failed because state from a previous run is still there.
 *
 * Both bootstrap scripts create a server and then create accounts inside it, so both are
 * idempotent only against a *fresh* container. Run either against one that already has those
 * accounts and it fails — in two different voices, neither of which names the cause:
 *
 * ```
 * matrix:      register theokit-bot failed: {… "errcode":"M_FORBIDDEN",
 *                                              "error":"Invalid registration token"}
 * mattermost:  create first user failed (400): An account with that username already exists.
 * ```
 *
 * The first is actively misleading. The token was read from the log and sent correctly; it is
 * "invalid" only because the server consumed it at its first boot. Someone reading that goes
 * looking for a wrong token, which is not the problem, and the actual remedy is one command.
 *
 * `bootstrap-matrix.ts` already explains the neighbouring case in prose — a token the log no
 * longer holds — and prints the `:down` remedy for it. This is the case it does not cover: a
 * token the log still holds, already spent. Same remedy, no message.
 *
 * Kept apart from both scripts, and pure, because the scripts are untestable by construction:
 * they boot containers and call `process.exit`. The decision "is this reused state?" is the only
 * part with a right answer, so it is the part that gets tested.
 *
 * @module
 */

/** The servers this project boots for itself, each with its own teardown script. */
export type SelfHostedPlatform = "matrix" | "mattermost";

/**
 * How each server refuses when its state survives from a previous run.
 *
 * One signature per platform on purpose. Matching Mattermost's wording under Matrix would be a
 * coincidence rather than a diagnosis, and a remedy that names the wrong server is worse than no
 * remedy at all: confidently actionable, wrong, and a boot cycle to disprove.
 */
const SIGNATURES: Record<SelfHostedPlatform, readonly string[]> = {
  matrix: ["invalid registration token"],
  mattermost: ["an account with that username already exists"],
};

/**
 * The remedy for a bootstrap failure caused by leftover state, or `undefined`.
 *
 * Silent on anything it does not recognise, and that silence is the feature. Attaching the advice
 * to every failure would send someone to recreate a container over a network blip or a wrong
 * port, and would train them to skip the line — which is how a helpful message becomes noise.
 *
 * @param platform which server was being bootstrapped
 * @param message whatever the server or the script said, in any casing
 */
export function reusedStateAdvice(
  platform: SelfHostedPlatform,
  message: string,
): string | undefined {
  const haystack = message.toLowerCase();
  const matched = SIGNATURES[platform].some((signature) => haystack.includes(signature));
  if (!matched) return undefined;
  return (
    `This looks like state left by a previous run: the container is still holding the accounts ` +
    `this script creates, so creating them again is refused. Recreate it and retry:\n` +
    `  pnpm --filter @theokit/gateway-integration ${platform}:down\n` +
    `  pnpm --filter @theokit/gateway-integration ${platform}:up`
  );
}
