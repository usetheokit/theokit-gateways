/**
 * Hook control: imports the Teams SDK middleware in the file's own top-level `beforeAll`, so its
 * record must read false. A preload moved into a hook is still paid inside a vitest budget
 * (the hook budget), and this control is what proves the recorder runs before the file's own hooks
 * and catches that move.
 */
import { createRequire } from "node:module";

import { beforeAll, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const SDK_MIDDLEWARE = require.resolve("@microsoft/teams.apps/dist/middleware/index.js");

beforeAll(async () => {
  await import("@microsoft/teams.apps/dist/middleware/index.js");
});

it("sees the SDK middleware loaded after its own beforeAll imported it", () => {
  expect(SDK_MIDDLEWARE in require.cache).toBe(true);
});
