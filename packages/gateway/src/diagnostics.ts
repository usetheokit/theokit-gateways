import { redactSecrets } from "./security/credential-patterns.js";

/** Options for {@link reportDiagnostic}. */
export interface ReportDiagnosticOptions {
  /** A failure (as opposed to an informational line). Default false. */
  readonly failure?: boolean;
}

/**
 * Redact, prefix with `[tag] `, and write one line.
 *
 * Every diagnostic line from the gateway goes through here, so redaction (and
 * later, routing) happens in one place. `options.failure` does not change the
 * output today; it marks the line for routing once the SDK exports its emitters.
 */
export function reportDiagnostic(
  tag: string,
  message: string,
  _options: ReportDiagnosticOptions = {},
): void {
  process.stderr.write(`[${tag}] ${redactSecrets(message)}\n`);
}
