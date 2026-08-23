// The `repository` every published package must declare, and every way it can be wrong.
//
// Written after a release failed on it: eleven packages set `publishConfig.provenance: true` and
// none declared a repository, so npm refused the whole publish with `422 … "repository.url" is ""`
// — nine minutes into a run whose build, tests and live gate had all passed.

import { describe, expect, it } from "vitest";

import { EXPECTED_REMOTE, repositoryProblem } from "../lib/repository-field.mjs";

const good = {
  repository: { type: "git", url: EXPECTED_REMOTE, directory: "packages/gateway-whatsapp" },
};

describe("repositoryProblem", () => {
  it("accepts a complete declaration", () => {
    expect(repositoryProblem(good, "gateway-whatsapp")).toBeUndefined();
  });

  it("names an absent repository — the state that failed the release", () => {
    expect(repositoryProblem({}, "gateway-whatsapp")).toBe("declares no repository");
  });

  it("names a shorthand string, which npm's provenance check does not accept here", () => {
    // `"repository": "github:org/repo"` is valid package.json and is NOT what the provenance
    // verifier reads, so it must not pass as "declared".
    expect(repositoryProblem({ repository: "github:usetheokit/theokit-gateways" }, "x")).toMatch(
      /string repository/,
    );
  });

  it("names an empty url separately from an absent repository", () => {
    // This is the literal state npm reported: the key exists, the url is "". Collapsing it into
    // "no repository" would send someone looking for a field that is already there.
    expect(repositoryProblem({ repository: { type: "git", url: "" } }, "x")).toBe(
      "declares a repository with no url",
    );
  });

  it("catches a remote that points somewhere else", () => {
    // The org moved once already. A stale remote passes every local gate and fails only at
    // publish, which is the most expensive place to find out.
    const stale = { repository: { url: "git+https://github.com/usetheo/theokit-gateways.git" } };
    expect(repositoryProblem(stale, "x")).toContain("not git+https://github.com/usetheokit/");
  });

  it("catches a directory pointing at the wrong package", () => {
    // A copy-paste between sibling manifests. npm does not reject it — it just sends every
    // consumer of one package to another package's source.
    const wrong = { repository: { url: EXPECTED_REMOTE, directory: "packages/gateway-slack" } };
    expect(repositoryProblem(wrong, "gateway-whatsapp")).toBe(
      "declares directory packages/gateway-slack, not packages/gateway-whatsapp",
    );
  });

  it("catches a missing directory", () => {
    const bare = { repository: { url: EXPECTED_REMOTE } };
    expect(repositoryProblem(bare, "gateway-whatsapp")).toContain("not packages/gateway-whatsapp");
  });
});
