/** Positive control: imports the Teams SDK middleware at module scope, so its record must read true. */
import "@microsoft/teams.apps/dist/middleware/index.js";

import { expect, it } from "vitest";

it("runs after a module-scope import of the SDK middleware", () => {
  expect(true).toBe(true);
});
