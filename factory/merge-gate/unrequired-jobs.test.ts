import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { unrequiredAddedJobs, type WorkflowFile } from "./unrequired-jobs";

/** chronicle's real workflow files, the regression fixture for this rule. */
const chronicle = (name: string): string =>
  fs.readFileSync(new URL(`fixtures/chronicle-workflows/${name}`, import.meta.url), "utf8");

const ci = (jobs: string): string => ["name: CI", "on:", "  pull_request:", "jobs:", jobs].join("\n");

const wf = (head: string, base?: string): WorkflowFile[] => [
  { path: ".github/workflows/ci.yml", head, base },
];

test("a job the pull request adds that no required name stands for is reported", () => {
  const before = ci(["  check:", "    runs-on: ubuntu-latest"].join("\n"));
  const after = ci(["  check:", "    runs-on: ubuntu-latest", "  lint:", "    runs-on: ubuntu-latest"].join("\n"));
  assert.deepEqual(unrequiredAddedJobs({ workflows: wf(after, before), required: ["check"] }), [
    { path: ".github/workflows/ci.yml", key: "lint", publishedName: "lint", rollUp: "check" },
  ]);
});

test("a job already in the target and unrequired is left alone", () => {
  const both = ci(["  check:", "    runs-on: ubuntu-latest", "  smoke:", "    runs-on: ubuntu-latest"].join("\n"));
  assert.deepEqual(unrequiredAddedJobs({ workflows: wf(both, both), required: ["check"] }), []);
});

test("a job reachable through a roll-up's needs, at any depth, counts as required", () => {
  const before = ci(
    ["  check:", "    needs: [build]", "  build:", "    needs: setup", "  setup:", "    runs-on: x"].join("\n"),
  );
  const after = [before, "  deep:", "    runs-on: x"].join("\n");
  const found = unrequiredAddedJobs({ workflows: wf(after, before), required: ["check"] });
  assert.deepEqual(
    found.map((j) => j.key),
    ["deep"],
  );
});

test("a job added under a required roll-up's needs is required, block list included", () => {
  const before = ci(["  check:", "    needs: [build]", "  build:", "    runs-on: x"].join("\n"));
  const after = ci(
    ["  check:", "    needs: [build]", "  build:", "    needs:", "      - probe", "  probe:", "    runs-on: x"].join(
      "\n",
    ),
  );
  assert.deepEqual(unrequiredAddedJobs({ workflows: wf(after, before), required: ["check"] }), []);
});

test("a job counts under the name it publishes, so a stub publishing a required name passes", () => {
  const after = ci(["  check:", "    runs-on: x", "  check-stub:", "    name: check", "    if: always()"].join("\n"));
  assert.deepEqual(unrequiredAddedJobs({ workflows: wf(after, ci("  check:\n    runs-on: x")), required: ["check"] }), []);
});

test("a matrix job counts by its key, though it reports the key plus its matrix values", () => {
  const before = ci(["  e2e:", "    needs: [e2e-shard]", "  e2e-shard:", "    runs-on: x"].join("\n"));
  const after = ci(
    [
      "  e2e:",
      "    needs: [e2e-shard]",
      "  e2e-shard:",
      "    strategy:",
      "      matrix:",
      "        shard: [1, 2, 3]",
      "  pack:",
      "    runs-on: x",
    ].join("\n"),
  );
  assert.deepEqual(
    unrequiredAddedJobs({ workflows: wf(after, before), required: ["e2e"] }).map((j) => j.key),
    ["pack"],
  );
});

test("a job-level uses: into another workflow file carries the requirement into its jobs", () => {
  const caller = ci(["  check:", "    uses: ./.github/workflows/reusable.yml"].join("\n"));
  const reusable = ["name: reusable", "on:", "  workflow_call:", "jobs:", "  build:", "    runs-on: x"].join("\n");
  const workflows = [
    { path: ".github/workflows/ci.yml", head: caller, base: caller },
    { path: ".github/workflows/reusable.yml", head: reusable },
  ];
  assert.deepEqual(unrequiredAddedJobs({ workflows, required: ["check"] }), []);
});

test("chronicle's own CI passes, pack and smoke included, because nothing added them", () => {
  const files: WorkflowFile[] = [".github/workflows/ci.yml", ".github/workflows/platform-smoke.yml"].map((path) => {
    const content = chronicle(path.split("/").pop()!);
    return { path, head: content, base: content };
  });
  assert.deepEqual(
    unrequiredAddedJobs({ workflows: files, required: ["factory/verdict", "check", "e2e", "gitleaks"] }),
    [],
  );
});

test("chronicle's unrequired pack and smoke are reported once a pull request adds them", () => {
  const smoke = chronicle("platform-smoke.yml");
  const found = unrequiredAddedJobs({
    workflows: [{ path: ".github/workflows/platform-smoke.yml", head: smoke }],
    required: ["check", "e2e", "gitleaks"],
  });
  assert.deepEqual(
    found.map((j) => j.key),
    ["pack", "smoke"],
  );
});

test("every job behind chronicle's e2e roll-up counts as required when added", () => {
  const ciYml = chronicle("ci.yml");
  const found = unrequiredAddedJobs({
    workflows: [{ path: ".github/workflows/ci.yml", head: ciYml }],
    required: ["check", "e2e", "gitleaks"],
  });
  assert.deepEqual(found, []);
});

test("a workflow that does not run on a pull request is not judged", () => {
  const release = ["name: release", "on:", "  push:", "    tags: ['v*']", "jobs:", "  publish:", "    runs-on: x"].join(
    "\n",
  );
  assert.deepEqual(
    unrequiredAddedJobs({ workflows: [{ path: ".github/workflows/release.yml", head: release }], required: ["check"] }),
    [],
  );
});
