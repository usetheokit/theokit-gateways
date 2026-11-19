import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p) =>
  JSON.parse(readFileSync(new URL(`../../packages/${p}/package.json`, import.meta.url), "utf8"));

describe("@theokit/sdk peer floor", () => {
  it.each(["gateway", "gateway-agent"])(
    "%s does not admit sdk releases with broken declarations",
    (pkg) => {
      const range = read(pkg).peerDependencies["@theokit/sdk"];
      const [maj, min] = range
        .match(/>=(\d+)\.(\d+)\./)
        .slice(1)
        .map(Number);
      expect(maj > 4 || (maj === 4 && min >= 62)).toBe(true);
    },
  );
});
