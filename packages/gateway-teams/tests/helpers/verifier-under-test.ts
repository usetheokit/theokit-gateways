/**
 * The verifier as the tests build it: the public options, plus a module standing in for the SDK's
 * middleware module. The stand-in reaches the verifier through the internal factory, never through
 * the options, which carry no such seam (loop-code-review LCR0121).
 */

import { createActivityVerifier } from "../../src/activity-verifier.js";
import type { TeamsActivityVerifierOptions } from "../../src/index.js";
import { importSdkMiddleware } from "../../src/sdk-validator.js";

/** {@link TeamsActivityVerifierOptions} plus the module the SDK validator is read from. */
export interface VerifierUnderTestOptions extends TeamsActivityVerifierOptions {
  /** Stands in for the SDK's middleware module; a rejecting thenable is a failed import. */
  readonly validatorModule?: unknown;
}

/**
 * A verifier reading its validator from `options.validatorModule`, or from the installed SDK when
 * that is absent. The options object is handed on as is, so a getter or a prototype in it reaches
 * the verifier as it would through `teamsActivityVerifier`.
 */
export function verifierUnderTest(
  options: VerifierUnderTestOptions,
): ReturnType<typeof createActivityVerifier> {
  const { validatorModule } = options;
  return createActivityVerifier(
    options,
    validatorModule === undefined ? importSdkMiddleware : async () => validatorModule,
  );
}
