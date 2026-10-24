// The release job must run `tools/release-path.mjs` before `changesets/action`, so the action
// finds no pending file when nothing pending is releasable and takes its publish path. The step
// moves files in the job's checkout only; a git write there could carry the set-aside to `main`.
//
// The workflow is read as text: the tools package has no YAML library. Comment lines are dropped
// first, because release.yml's comments name `changesets/action@` and `git commit` themselves.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(new URL("../../.github/workflows/release.yml", import.meta.url));

const DECISION = /node tools\/release-path\.mjs \.changeset --set-aside\b/;
const UNDER_RUNNER_TEMP = /--set-aside\s+"?\$\{?RUNNER_TEMP\}?\//;
const ACTION = /^\s*(?:- )?uses:\s*changesets\/action@/m;
const GIT_WRITE = /\bgit\s+(?:add|commit|push|rm)\b/;

function withoutComments(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+#.*$/, ""));
}

// The lines of the `release` job: from `  release:` to the next key at its indentation or less.
function releaseJobLines(lines) {
  const start = lines.findIndex((line) => /^ {2}release:\s*$/.test(line));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {0,2}\S/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

// One text block per step: a step starts at a list item at the indentation of the first one.
function stepBlocks(jobLines) {
  const first = jobLines.find((line) => /^\s*- (?:name|uses|run):/.test(line));
  if (first === undefined) return [];
  const itemStart = `${first.match(/^\s*/)[0]}- `;
  const blocks = [];
  for (const line of jobLines) {
    if (line.startsWith(itemStart)) blocks.push([]);
    blocks.at(-1)?.push(line);
  }
  return blocks.map((block) => block.join("\n"));
}

// What is wrong with the release job's decision step, as a list; empty when nothing is.
function decisionStepFindings(workflowText) {
  const steps = stepBlocks(releaseJobLines(withoutComments(workflowText)));
  const decisionAt = steps.findIndex((step) => DECISION.test(step));
  const actionAt = steps.findIndex((step) => ACTION.test(step));
  if (actionAt === -1) return ["no changesets action step"];
  if (decisionAt === -1) return ["no decision step"];
  const decision = steps[decisionAt];
  return [
    decisionAt > actionAt && "decision step after action",
    !UNDER_RUNNER_TEMP.test(decision) && "set-aside not under RUNNER_TEMP",
    GIT_WRITE.test(decision) && "git write in decision step",
  ].filter(Boolean);
}

const STEP_DECIDE = [
  "      - name: Set aside changesets that release nothing",
  '        run: node tools/release-path.mjs .changeset --set-aside "$RUNNER_TEMP/aside"',
];
const STEP_ACTION = [
  "      - name: Create Release Pull Request or Publish",
  "        uses: changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d # v1.9.0",
  "        with:",
  "          publish: pnpm changeset publish",
];

function workflowWith(steps) {
  const header = ["jobs:", "  release:", "    runs-on: ubuntu-latest", "    steps:"];
  return [...header, "      - run: pnpm build", ...steps.flat(), ""].join("\n");
}

describe("the release workflow", () => {
  const findings = decisionStepFindings(readFileSync(workflowPath, "utf8"));

  it("runs the release-path decision before the changesets action", () => {
    expect(findings).not.toContain("no changesets action step");
    expect(findings).not.toContain("no decision step");
    expect(findings).not.toContain("decision step after action");
  });

  it("sets aside under the runner temp directory", () => {
    expect(findings).not.toContain("no decision step");
    expect(findings).not.toContain("set-aside not under RUNNER_TEMP");
  });

  it("the decision step writes nothing to git", () => {
    expect(findings).not.toContain("no decision step");
    expect(findings).not.toContain("git write in decision step");
  });

  it("rejects a workflow whose decision step comes after the action", () => {
    expect(decisionStepFindings(workflowWith([STEP_DECIDE, STEP_ACTION]))).toEqual([]);
    expect(decisionStepFindings(workflowWith([STEP_ACTION, STEP_DECIDE]))).toEqual([
      "decision step after action",
    ]);
  });

  it("reports every other finding on a workflow that earns it", () => {
    const committing = [
      "      - name: Set aside and commit",
      "        run: |",
      '          node tools/release-path.mjs .changeset --set-aside "$RUNNER_TEMP/aside"',
      "          git commit -am 'drop changesets'",
    ];
    const outsideTemp = [
      "      - run: node tools/release-path.mjs .changeset --set-aside /tmp/aside",
    ];
    const cases = [
      [[committing, STEP_ACTION], "git write in decision step"],
      [[outsideTemp, STEP_ACTION], "set-aside not under RUNNER_TEMP"],
      [[STEP_ACTION], "no decision step"],
      [[STEP_DECIDE], "no changesets action step"],
    ];
    for (const [steps, finding] of cases) {
      expect(decisionStepFindings(workflowWith(steps))).toEqual([finding]);
    }
  });
});
