import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Sonar resolves a relative `SF:` record against the repository root, where it
      // scans, so the record must be repo-relative: `src/index.ts` would match nothing
      // here, or the wrong package's file.
      reporter: [
        "text-summary",
        ["lcov", { projectRoot: fileURLToPath(new URL("../..", import.meta.url)) }],
      ],
    },
  },
});
