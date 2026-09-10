/**
 * The wiring a rename can break. The subject is the repo's own workflow files,
 * so the tree is the fixture: the four workflows that run a model carry
 * sandcastle's `agent-` names and nothing answers to the old ones, the caller
 * template calls files the factory has, the reconciler still reads a role out
 * of each agent workflow's jobs, and every agent job is serialised on its own
 * subject number with no per-account lane left anywhere (#149).
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

/**
 * The group each agent job must be serialised on: its subject, the issue number
 * on the ticket side and the PR number on the PR side (#149). The role is not
 * part of the key, so a review and an implement-pr run on one PR share a group
 * and cannot overlap, while two different subjects never share one at all.
 */
const SUBJECT_KEYS: Record<string, string> = {
  "agent-implement.yml": "factory-issue-${{ github.event.issue.number }}",
  "agent-review.yml": "factory-pr-${{ github.event.pull_request.number }}",
  "agent-implement-pr.yml": "factory-pr-${{ github.event.pull_request.number }}",
  "agent-audit.yml": "factory-pr-${{ github.event.pull_request.number }}",
};

/**
 * Every other concurrency group in the repo, `file:job` to group name. Each
 * serialises one shared resource, not a subject: the audit counter is the one
 * inside an agent workflow, and it is not the lane cap.
 */
const SERIALISING_GROUPS: Record<string, string> = {
  "agent-audit.yml:decide": "factory-audit-counter",
  "dispatch.yml:dispatch": "factory-dispatch",
  "update-branch.yml:update": "factory-update-branch",
};

const exists = (file: string): boolean => fs.existsSync(new URL(file, workflowsDir));

const workflowFiles = (): string[] => fs.readdirSync(workflowsDir).sort();

const read = (file: string): string => fs.readFileSync(new URL(file, workflowsDir), "utf8");

/** Top-level jobs with their bodies: two-space indented keys, from the `jobs:` line on. */
const jobsOf = (yaml: string): { id: string; body: string }[] => {
  const start = yaml.indexOf("\njobs:");
  assert.ok(start >= 0, "the workflow has a top-level jobs: block");
  const jobs = yaml.slice(start);
  const heads = [...jobs.matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)];
  return heads.map((head, i) => ({ id: head[1]!, body: jobs.slice(head.index!, heads[i + 1]?.index ?? jobs.length) }));
};

const jobIdsOf = (yaml: string): string[] => jobsOf(yaml).map((job) => job.id);

/**
 * Every job-level concurrency block in the repo's workflows, in file then job
 * order. Comment lines inside the block are skipped: why a job is serialised the
 * way it is belongs next to the key.
 */
const COMMENTS = "(?: {6}#.*\\n)*";
const CONCURRENCY = new RegExp(`^ {4}concurrency:\\n${COMMENTS} {6}group: (.+)\\n${COMMENTS} {6}cancel-in-progress: (.+)$`, "m");

const concurrencyBlocks = (): { file: string; job: string; group: string; cancelInProgress: string }[] =>
  workflowFiles().flatMap((file) =>
    jobsOf(read(file)).flatMap((job) => {
      const block = job.body.match(CONCURRENCY);
      return block ? [{ file, job: job.id, group: block[1]!, cancelInProgress: block[2]! }] : [];
    }),
  );

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

test("no workflow picks a lane or declares the per-account cap, and the template does not offer it", () => {
  // The cap is gone (#149). A lane was a job or step that divided the subject
  // number by N, handing an index to an `account-slot-<i>` group; a caller that
  // still passed the input would fail the whole factory workflow at parse time.
  for (const file of workflowFiles()) {
    const yaml = read(file);
    assert.ok(!yaml.includes("per_account_slots"), `${file} still declares per_account_slots`);
    assert.ok(!yaml.includes("account-slot"), `${file} still names an account-slot group`);
    assert.ok(!jobIdsOf(yaml).includes("slot"), `${file} still has a slot job`);
    assert.doesNotMatch(yaml, /^\s*id: slot$/m, `${file} still has a slot step`);
  }
  const template = fs.readFileSync(new URL("templates/factory.yml", repoRoot), "utf8");
  assert.ok(!template.includes("per_account_slots"), "the template still mentions per_account_slots");
});

test("every agent job is serialised on its subject number, and no other group is keyed on a subject", () => {
  // Two runs on one ticket or PR never overlap; unrelated subjects never share a
  // key, so nothing waits behind a run it has nothing to do with (#149).
  const blocks = concurrencyBlocks();
  const agentJobs = Object.entries(AGENT_WORKFLOWS).map(([file, role]) => {
    const block = blocks.find((b) => b.file === file && b.job === role);
    assert.ok(block, `${file}: the ${role} job declares no concurrency group`);
    return block;
  });
  for (const { file, group, cancelInProgress } of agentJobs) {
    assert.equal(group, SUBJECT_KEYS[file], `${file}: the agent job's group is keyed on its subject number`);
    // Never cancel a sibling run on the same subject: the older one is doing real work.
    assert.equal(cancelInProgress, "false", `${file}: the agent job cancels a run on the same subject`);
  }
  // The role is not part of the key, so the three PR-side roles share one group.
  const prSide = agentJobs.filter(({ file }) => file !== "agent-implement.yml").map(({ group }) => group);
  assert.equal(new Set(prSide).size, 1, "review, implement-pr and audit share one group on one PR");
  assert.ok(!prSide.includes(SUBJECT_KEYS["agent-implement.yml"]!), "a PR number and an issue number are different keys");
  // Everything else serialises a shared resource. The audit counter is one of
  // these, not a lane: two merges landing together must not both read 19.
  const others = Object.fromEntries(
    blocks.filter((b) => !agentJobs.some((a) => a.file === b.file && a.job === b.job)).map((b) => [`${b.file}:${b.job}`, b.group]),
  );
  assert.deepEqual(others, SERIALISING_GROUPS);
});

test("the reconciler reads a role from each agent workflow's own job", () => {
  for (const [file, role] of Object.entries(AGENT_WORKFLOWS)) {
    const ids = jobIdsOf(read(file));
    assert.ok(!ids.includes("workflow_call"), `${file} job ids come from jobs:, not on:`);
    assert.equal(
      roleFromJobs(ids.map((name) => ({ name: `caller / ${name}`, conclusion: null }))),
      role,
      `${file} jobs read as ${role}`,
    );
  }
});
