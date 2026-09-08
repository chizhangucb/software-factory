/**
 * The wiring a rename can break. The subject is the repo's own workflow files,
 * so the tree is the fixture: the four workflows that run a model carry
 * sandcastle's `agent-` names and nothing answers to the old ones, the caller
 * template calls files the factory has, and the reconciler still reads a role
 * out of each agent workflow's job.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { type RunRole, roleFromJobs } from "./reconcile.ts";

const repoRoot = new URL("../../", import.meta.url);
const workflowsDir = new URL(".github/workflows/", repoRoot);

/** The workflows that run a model, sandcastle's names, and the role the reconciler must read from each. */
const AGENT_WORKFLOWS: Record<string, RunRole> = {
  "agent-implement.yml": "implement",
  "agent-review.yml": "review",
  "agent-implement-pr.yml": "implement-pr",
  "agent-audit.yml": "audit",
};

/** What those four were called before #61. No file answers to them now. */
const OLD_NAMES = ["implement.yml", "review.yml", "implement-pr.yml", "audit.yml"];

const exists = (file: string): boolean => fs.existsSync(new URL(file, workflowsDir));

/** Top-level job ids: two-space indented keys, from the `jobs:` line on. */
const jobIdsOf = (yaml: string): string[] => {
  const jobs = yaml.indexOf("\njobs:");
  assert.ok(jobs >= 0, "the workflow has a top-level jobs: block");
  return [...yaml.slice(jobs).matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)].map((m) => m[1]!);
};

test("the workflows that run a model carry sandcastle's names and the old ones are gone", () => {
  for (const file of Object.keys(AGENT_WORKFLOWS)) assert.ok(exists(file), `${file} is missing`);
  for (const file of OLD_NAMES) assert.ok(!exists(file), `${file} still exists`);
  // The prefix is the whole point: a reader tells which jobs spend a subscription by the name.
  const prefixed = fs.readdirSync(workflowsDir).filter((f) => f.startsWith("agent-")).sort();
  assert.deepEqual(prefixed, Object.keys(AGENT_WORKFLOWS).sort(), "an agent- prefix means the workflow runs a model");
});

test("the caller template calls workflow files the factory has", () => {
  const template = fs.readFileSync(new URL("examples/factory.yml", repoRoot), "utf8");
  const called = [...template.matchAll(/uses:\s*\S+\/\.github\/workflows\/(\S+?)@/g)].map((m) => m[1]!);
  assert.deepEqual(
    called.filter((file) => !exists(file)),
    [],
    "every workflow the template calls exists",
  );
  for (const file of Object.keys(AGENT_WORKFLOWS)) assert.ok(called.includes(file), `the template never calls ${file}`);
});

test("the reconciler reads a role from each agent workflow's own job", () => {
  for (const [file, role] of Object.entries(AGENT_WORKFLOWS)) {
    const ids = jobIdsOf(fs.readFileSync(new URL(file, workflowsDir), "utf8"));
    assert.ok(!ids.includes("workflow_call"), `${file} job ids come from jobs:, not on:`);
    assert.equal(
      roleFromJobs(ids.map((name) => ({ name: `caller / ${name}`, conclusion: null }))),
      role,
      `${file} jobs read as ${role}`,
    );
  }
});
