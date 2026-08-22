import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    // Several of these tests drive the TypeScript compiler in-process (`ts.createProgram`),
    // which pays a one-time lib-loading cost. Alone that fits inside the 5s default; run under
    // `pnpm -r test`, with twelve package suites competing for the same cores, it does not — and
    // the suite failed on load rather than on behaviour. Stating the cost is the fix; shortening
    // the work would mean testing less of it.
    testTimeout: 30_000,
    include: ["tests/**/*.test.mjs"],
    environment: "node",
  },
});
