/**
 * The kind of a caught failure, for a refusal or a key-set message (ADR-0005).
 *
 * @internal
 */

/** An identifier-shaped value, so nothing but a class name or an error code reaches a message. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * The kind of a caught failure, for a refusal message: the error's class and, when it carries one,
 * its `code` (`TypeError`, `Error ERR_MODULE_NOT_FOUND`). The error's own text is left out: it
 * belongs to the SDK, the module loader or the network, and a refusal repeats only what the
 * verifier decided.
 */
export function errorKind(error: unknown): string {
  if (typeof error !== "object" || error === null) return `a thrown ${typeof error}`;
  const { name, code } = error as { name?: unknown; code?: unknown };
  const kind = typeof name === "string" && IDENTIFIER.test(name) ? name : "an unnamed error";
  return typeof code === "string" && IDENTIFIER.test(code) ? `${kind} ${code}` : kind;
}
