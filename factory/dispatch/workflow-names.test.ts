/**
 * The wiring a rename can break, checked against the tree rather than a fixture:
 * the four workflows that run a model carry sandcastle's `agent-` names, the
 * caller template names files the factory actually has, and the reconciler still
 * reads a role out of each agent workflow's job.
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

/** The workflows that run no model keep plain names. */
const PLAIN_WORKFLOWS = ["dispatch.yml", "gate.yml", "update-branch.yml", "ci.yml"];

const readWorkflow = (file: string): string => fs.readFileSync(new URL(file, workflowsDir), "utf8");

/** Top-level job ids: two-space indented keys under `jobs:`. */
const jobIdsOf = (yaml: string): string[] => [...yaml.matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)].map((m) => m[1]!);

test("every workflow file is either an agent workflow under sandcastle's name or a plain one", () => {
  const present = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml")).sort();
  assert.deepEqual(present, [...Object.keys(AGENT_WORKFLOWS), ...PLAIN_WORKFLOWS].sort());
});

test("the caller template calls workflow files the factory has", () => {
  const template = fs.readFileSync(new URL("examples/factory.yml", repoRoot), "utf8");
  const called = [...template.matchAll(/uses:\s*\S+\/\.github\/workflows\/(\S+?)@/g)].map((m) => m[1]!);
  assert.ok(called.length > 0, "the template calls at least one factory workflow");
  for (const file of called) assert.ok(fs.existsSync(new URL(file, workflowsDir)), `${file} does not exist`);
});

test("the reconciler reads a role from each agent workflow's own job", () => {
  for (const [file, role] of Object.entries(AGENT_WORKFLOWS)) {
    const jobs = jobIdsOf(readWorkflow(file)).map((name) => ({ name: `caller / ${name}`, conclusion: null }));
    assert.equal(roleFromJobs(jobs), role, `${file} jobs read as ${role}`);
  }
});
