import { maskSecrets } from "@theokit/gateway";

/** Longest suffix of `text` that is a proper prefix of some secret (it may still grow into one). */
function pendingTail(text: string, secrets: ReadonlyArray<string>): number {
  let best = 0;
  for (const secret of secrets) {
    const max = Math.min(secret.length - 1, text.length);
    for (let n = max; n > best; n--) {
      if (text.endsWith(secret.slice(0, n))) {
        best = n;
        break;
      }
    }
  }
  return best;
}

/**
 * Masks exact secret values in streamed text, holding back a tail that could still grow into a
 * value split across chunks. `push` returns text safe to emit; `flush` returns what was held.
 *
 * @public
 */
export function createStreamMasker(secrets: ReadonlyArray<string>): {
  push(chunk: string): string;
  flush(): string;
} {
  const values = secrets.filter((s) => s.length > 0);
  let held = "";
  return {
    push(chunk) {
      const masked = maskSecrets(held + chunk, values);
      const keep = pendingTail(masked, values);
      held = keep > 0 ? masked.slice(masked.length - keep) : "";
      return masked.slice(0, masked.length - keep);
    },
    flush() {
      const out = maskSecrets(held, values);
      held = "";
      return out;
    },
  };
}
