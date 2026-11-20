import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const scripts = root.scripts;

describe("coverage:sonar", () => {
  const [workspaces, integration, ...rest] = scripts["coverage:sonar"].split(" && ");

  it("runs as exactly two commands, workspaces then integration", () => {
    expect(rest).toEqual([]);
    expect(integration).toBeDefined();
  });

  it("covers every workspace package except the live integration one", () => {
    expect(workspaces).toContain("pnpm -r");
    expect(workspaces).toContain("--filter '!@theokit/gateway-integration'");
    expect(workspaces).toContain("exec vitest run");
  });

  it("restricts integration to its offline tests, never the live suite", () => {
    expect(integration).toContain("--filter @theokit/gateway-integration exec vitest run");
    expect(integration).toContain("tests/unit tests/readiness.test.ts");
    const unit = root.scripts;
    expect(unit["integration"]).toBeDefined();
    expect(integration).not.toMatch(/pnpm integration|gateway-e2e/);
  });

  it("writes LCOV with the v8 provider in both commands", () => {
    for (const cmd of [workspaces, integration]) {
      expect(cmd).toContain("--coverage.enabled");
      expect(cmd).toContain("--coverage.provider=v8");
      expect(cmd).toContain("--coverage.reporter=lcov");
    }
  });

  it("declares the v8 provider so it resolves from every package", () => {
    expect(root.devDependencies["@vitest/coverage-v8"]).toBeDefined();
  });

  it("produces the reports sonar-project.properties imports", () => {
    const props = readFileSync(new URL("../../sonar-project.properties", import.meta.url), "utf8");
    expect(props).toContain("integration/coverage/lcov.info");
    expect(props).toContain("tools/coverage/lcov.info");
  });
});

describe("sonar:scan", () => {
  it("invokes a pinned scanner", () => {
    expect(scripts["sonar:scan"]).toMatch(/pnpm dlx @sonar\/scan@\d+\.\d+\.\d+$/);
  });
});
