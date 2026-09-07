import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCKED_LABEL,
  type CommitStatus,
  type HeadCommit,
  type OpenPr,
  carriedVerdict,
  findVerdict,
  isUpdateMerge,
  planUpdate,
  planUpdates,
} from "./plan.ts";

const pr = (number: number, overrides: Partial<OpenPr> = {}): OpenPr => ({
  number,
  autoMerge: true,
  behindBy: 2,
  mergeable: "MERGEABLE",
  labels: [],
  head: { sha: "h1", parents: ["p0"], committerLogin: "factory-agent[bot]" },
  verdict: { state: "success", sha: "h1" },
  ...overrides,
});

const actions = (prs: readonly OpenPr[]): string[] =>
  planUpdates(prs).map((plan) => `${plan.number}:${plan.action}${plan.carry ? "+carry" : ""}`);

test("a factory PR with auto-merge on, a passing verdict, and a stale head is updated", () => {
  assert.deepEqual(actions([pr(7)]), ["7:update"]);
  assert.equal(planUpdate(pr(7)).reason, "2 behind main");
});

test("a PR already on the latest main is left alone", () => {
  assert.deepEqual(actions([pr(7, { behindBy: 0 })]), ["7:skip"]);
  assert.equal(planUpdate(pr(7, { behindBy: 0 })).reason, "up to date");
});

test("a PR without auto-merge is not the factory's to update", () => {
  assert.deepEqual(actions([pr(7, { autoMerge: false })]), ["7:skip"]);
  assert.equal(planUpdate(pr(7, { autoMerge: false })).reason, "auto-merge not enabled");
});

test("a PR whose reviewer is running waits; the review's dispatch brings it back", () => {
  const reviewing = pr(7, { verdict: { state: "pending", sha: "h1" } });
  assert.deepEqual(actions([reviewing]), ["7:skip"]);
  assert.equal(planUpdate(reviewing).reason, "reviewer running");
});

test("a stale PR with no verdict yet is still updated; the reviewer's verdict is carried onto the merge", () => {
  assert.deepEqual(actions([pr(7, { verdict: { state: "none", sha: "h1" } })]), ["7:update"]);
});

test("a PR whose verdict failed is not updated, wherever that verdict sits; it cannot merge until a re-review", () => {
  const failed = pr(7, { verdict: { state: "failure", sha: "h1" } });
  assert.deepEqual(actions([failed]), ["7:skip"]);
  assert.equal(planUpdate(failed).reason, "verdict failure on h1, waiting for a re-review");
  assert.deepEqual(actions([pr(7, { verdict: { state: "error", sha: "h0" } })]), ["7:skip"]);
});

test("a stale PR that conflicts with main is escalated, not updated", () => {
  const conflicting = pr(7, { mergeable: "CONFLICTING" });
  assert.deepEqual(actions([conflicting]), ["7:escalate"]);
  assert.equal(planUpdate(conflicting).reason, "conflicts with main");
});

test("a conflicting PR already labeled blocked is not escalated twice", () => {
  const already = pr(7, { mergeable: "CONFLICTING", labels: [BLOCKED_LABEL] });
  assert.deepEqual(actions([already]), ["7:skip"]);
  assert.equal(planUpdate(already).reason, `conflicts with main, already ${BLOCKED_LABEL}`);
});

test("an unknown mergeability is tried anyway; the API answers with a conflict if there is one", () => {
  assert.deepEqual(actions([pr(7, { mergeable: "UNKNOWN" })]), ["7:update"]);
});

test("two stale PRs opened together are both updated, lowest number first", () => {
  assert.deepEqual(actions([pr(9), pr(8), pr(10, { behindBy: 0 })]), ["8:update", "9:update", "10:skip"]);
});

const updateMerge: HeadCommit = { sha: "h2", parents: ["h1", "m3"], committerLogin: "web-flow" };

test("a passing verdict below the head is carried onto the head", () => {
  const stalled = pr(7, { behindBy: 0, head: updateMerge, verdict: { state: "success", sha: "h1" } });
  assert.deepEqual(actions([stalled]), ["7:skip+carry"]);
  assert.equal(planUpdate(stalled).reason, "up to date, verdict to carry from h1");
});

test("a stale head carries first, then updates, so the verdict survives a chain of updates", () => {
  assert.deepEqual(actions([pr(7, { head: updateMerge, verdict: { state: "success", sha: "h1" } })]), ["7:update+carry"]);
});

test("every plan carries a reason a log line can print", () => {
  for (const plan of planUpdates([pr(1), pr(2, { autoMerge: false }), pr(3, { mergeable: "CONFLICTING" })])) {
    assert.ok(plan.reason.length > 0, `#${plan.number}`);
  }
});

test("isUpdateMerge names GitHub's own two-parent merge and nothing else", () => {
  assert.equal(isUpdateMerge(updateMerge), true);
  assert.equal(isUpdateMerge({ ...updateMerge, committerLogin: null }), false);
  assert.equal(isUpdateMerge({ ...updateMerge, committerLogin: "factory-agent[bot]" }), false);
  assert.equal(isUpdateMerge({ ...updateMerge, parents: ["h1"] }), false);
});

const status = (state: CommitStatus["state"]): CommitStatus => ({ context: "factory/verdict", state, description: null, target_url: null });

const chain = (
  commits: Record<string, HeadCommit>,
  statuses: Record<string, CommitStatus[]>,
) => ({
  statusesOf: (sha: string) => statuses[sha] ?? [],
  commitOf: (sha: string) => {
    const c = commits[sha];
    if (!c) throw new Error(`no commit ${sha}`);
    return c;
  },
});

test("findVerdict takes the verdict on the head itself first", () => {
  const { statusesOf, commitOf } = chain({}, { h2: [status("failure")] });
  assert.deepEqual(findVerdict(updateMerge, statusesOf, commitOf), { state: "failure", sha: "h2" });
});

test("findVerdict walks first parents through GitHub's update merges to the head the reviewer judged", () => {
  const h1: HeadCommit = { sha: "h1", parents: ["p0"], committerLogin: "factory-agent[bot]" };
  const h3: HeadCommit = { sha: "h3", parents: ["h2", "m4"], committerLogin: "web-flow" };
  const { statusesOf, commitOf } = chain({ h2: updateMerge, h1 }, { h1: [status("failure")] });
  assert.deepEqual(findVerdict(h3, statusesOf, commitOf), { state: "failure", sha: "h1" });
});

test("findVerdict stops at a commit a person or an agent made, and reports none on the head", () => {
  const agentMerge: HeadCommit = { sha: "h2", parents: ["h1", "m3"], committerLogin: "factory-agent[bot]" };
  const h1: HeadCommit = { sha: "h1", parents: ["p0"], committerLogin: "factory-agent[bot]" };
  const { statusesOf, commitOf } = chain({ h1 }, { h1: [status("success")] });
  assert.deepEqual(findVerdict(agentMerge, statusesOf, commitOf), { state: "none", sha: "h2" });
  assert.deepEqual(findVerdict(h1, statusesOf, commitOf), { state: "success", sha: "h1" });
});

test("findVerdict gives up after maxHops without touching commits beyond it", () => {
  const commits: Record<string, HeadCommit> = {};
  for (let i = 1; i <= 5; i++) commits[`h${i}`] = { sha: `h${i}`, parents: [`h${i - 1}`, "m"], committerLogin: "web-flow" };
  const { statusesOf, commitOf } = chain(commits, { h0: [status("success")] });
  assert.deepEqual(findVerdict(commits.h5!, statusesOf, commitOf, 2), { state: "none", sha: "h5" });
});

const verdict = (state: CommitStatus["state"]): CommitStatus => ({
  context: "factory/verdict",
  state,
  description: "3/3 acceptance criteria met",
  target_url: "https://example.test/run/1",
});

test("a passing verdict on the old head is carried with its provenance", () => {
  const carried = carriedVerdict([verdict("success")], "aaaaaaa1bbbbbbb2");
  assert.deepEqual(carried, {
    context: "factory/verdict",
    state: "success",
    description: "3/3 acceptance criteria met (carried from aaaaaaa by update-branch)",
    target_url: "https://example.test/run/1",
  });
});

test("a verdict carried a second time keeps one provenance note, not a chain", () => {
  const once = carriedVerdict([verdict("success")], "aaaaaaa1")!;
  const twice = carriedVerdict([once], "bbbbbbb2");
  assert.equal(twice?.description, "3/3 acceptance criteria met (carried from bbbbbbb by update-branch)");
});

test("a failing or pending verdict is never carried", () => {
  assert.equal(carriedVerdict([verdict("failure")], "aaaaaaa1"), undefined);
  assert.equal(carriedVerdict([verdict("pending")], "aaaaaaa1"), undefined);
  assert.equal(carriedVerdict([verdict("error")], "aaaaaaa1"), undefined);
});

test("other contexts are ignored and a head without a verdict carries nothing", () => {
  const gate: CommitStatus = { context: "factory/red-green", state: "success", description: "clean", target_url: null };
  assert.equal(carriedVerdict([gate], "aaaaaaa1"), undefined);
  assert.equal(carriedVerdict([], "aaaaaaa1"), undefined);
});

test("the carried description stays inside GitHub's 140 character status limit", () => {
  const long: CommitStatus = { ...verdict("success"), description: "x".repeat(140) };
  const description = carriedVerdict([long], "aaaaaaa1")?.description ?? "";
  assert.ok(description.length <= 140 && description.length > 40);
  assert.ok(description.endsWith("(carried from aaaaaaa by update-branch)"));
});
