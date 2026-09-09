/**
 * The wiring a rename can break. The subject is the repo's own workflow files,
 * so the tree is the fixture: the four workflows that run a model carry
 * sandcastle's `agent-` names and nothing answers to the old ones, the caller
 * template calls files the factory has, and the reconciler still reads a role,
 * and a slot cancel, out of each agent workflow's jobs.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { type RunRole, cancelCauseFromJobs, roleFromJobs } from "./reconcile.ts";

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

/** Top-level jobs with their bodies: two-space indented keys, from the `jobs:` line on. */
const jobsOf = (yaml: string): { id: string; body: string }[] => {
  const start = yaml.indexOf("\njobs:");
  assert.ok(start >= 0, "the workflow has a top-level jobs: block");
  const jobs = yaml.slice(start);
  const heads = [...jobs.matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)];
  return heads.map((head, i) => ({ id: head[1]!, body: jobs.slice(head.index!, heads[i + 1]?.index ?? jobs.length) }));
};

const jobIdsOf = (yaml: string): string[] => jobsOf(yaml).map((job) => job.id);

test("the workflows that run a model carry sandcastle's names and the old ones are gone", () => {
  for (const file of Object.keys(AGENT_WORKFLOWS)) assert.ok(exists(file), `${file} is missing`);
  for (const file of OLD_NAMES) assert.ok(!exists(file), `${file} still exists`);
  // The prefix is the whole point: a reader tells which jobs spend a subscription by the name.
  const prefixed = fs.readdirSync(workflowsDir).filter((f) => f.startsWith("agent-")).sort();
  assert.deepEqual(prefixed, Object.keys(AGENT_WORKFLOWS).sort(), "an agent- prefix means the workflow runs a model");
});

test("the caller template calls workflow files the factory has", () => {
  const template = fs.readFileSync(new URL("templates/factory.yml", repoRoot), "utf8");
  const called = [...template.matchAll(/uses:\s*\S+\/\.github\/workflows\/(\S+?)@/g)].map((m) => m[1]!);
  assert.deepEqual(
    called.filter((file) => !exists(file)),
    [],
    "every workflow the template calls exists",
  );
  for (const file of Object.keys(AGENT_WORKFLOWS)) assert.ok(called.includes(file), `the template never calls ${file}`);
});

test("the reconciler reads a slot cancel out of the jobs the account-slot group actually holds", () => {
  // #17's cap is a `slot` group entered after a picker job hands over an index.
  // The reconciler only knows those two by name, so the workflows are the fixture:
  // rename either job and this fails instead of every cancel quietly re-reading
  // as a lost event.
  const held: string[] = [];
  for (const file of fs.readdirSync(workflowsDir).sort()) {
    const yaml = fs.readFileSync(new URL(file, workflowsDir), "utf8");
    for (const job of jobsOf(yaml)) {
      const group = job.body.match(/group: account-slot-\$\{\{ needs\.([a-z][a-z0-9_-]*)\.outputs\.index \}\}/);
      if (!group) continue;
      held.push(`${file}:${job.id}`);
      assert.equal(
        cancelCauseFromJobs([
          { name: `caller / ${group[1]}`, conclusion: "success" },
          { name: `caller / ${job.id}`, conclusion: "cancelled" },
        ]),
        "slot",
        `${file}: a cancelled ${job.id} behind a finished ${group[1]} reads as slot contention`,
      );
    }
  }
  assert.deepEqual(held, ["agent-audit.yml:audit", "agent-implement-pr.yml:implement-pr", "agent-implement.yml:implement", "agent-review.yml:review"]);
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
