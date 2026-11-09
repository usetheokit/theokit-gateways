import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // mailparser's ESM build imports `nodemailer/lib/addressparser` as a directory, which Node's ESM
    // resolver rejects once its nodemailer dependency is 9.x. Inlining lets Vite resolve it.
    server: { deps: { inline: [/mailparser/] } },
  },
});
