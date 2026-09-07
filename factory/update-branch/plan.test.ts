import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLOCKED_LABEL,
  type CommitStatus,
  type OpenPr,
  carriedVerdict,
  planUpdates,
  whyNotUpdated,
} from "./plan.ts";

const pr = (number: number, overrides: Partial<OpenPr> = {}): OpenPr => ({
  number,
  isDraft: false,
  autoMerge: true,
  behindBy: 2,
  mergeable: "MERGEABLE",
  labels: [],
  ...overrides,
});

const actions = (prs: readonly OpenPr[]): string[] =>
  planUpdates(prs).map((plan) => `${plan.number}:${plan.action}`);

test("a ready factory PR with auto-merge on and a stale head is updated", () => {
  assert.deepEqual(actions([pr(7)]), ["7:update"]);
  assert.equal(whyNotUpdated(pr(7)), undefined);
});

test("a PR already on the latest main is left alone", () => {
  assert.deepEqual(actions([pr(7, { behindBy: 0 })]), ["7:skip"]);
  assert.equal(whyNotUpdated(pr(7, { behindBy: 0 })), "up to date");
});

test("a PR without auto-merge is not the factory's to update", () => {
  assert.deepEqual(actions([pr(7, { autoMerge: false })]), ["7:skip"]);
  assert.equal(whyNotUpdated(pr(7, { autoMerge: false })), "auto-merge not enabled");
});

test("a draft waits for its verdict; the ready_for_review event updates it later", () => {
  assert.deepEqual(actions([pr(7, { isDraft: true })]), ["7:skip"]);
  assert.equal(whyNotUpdated(pr(7, { isDraft: true })), "draft");
});

test("a stale PR that conflicts with main is escalated, not updated", () => {
  const conflicting = pr(7, { mergeable: "CONFLICTING" });
  assert.deepEqual(actions([conflicting]), ["7:escalate"]);
  assert.equal(whyNotUpdated(conflicting), "conflicts with main");
});

test("a conflicting PR already labeled blocked is not escalated twice", () => {
  const already = pr(7, { mergeable: "CONFLICTING", labels: [BLOCKED_LABEL] });
  assert.deepEqual(actions([already]), ["7:skip"]);
  assert.equal(whyNotUpdated(already), `conflicts with main, already ${BLOCKED_LABEL}`);
});

test("an unknown mergeability is tried anyway; the API answers with a conflict if there is one", () => {
  assert.deepEqual(actions([pr(7, { mergeable: "UNKNOWN" })]), ["7:update"]);
});

test("two stale PRs opened together are both updated, lowest number first", () => {
  assert.deepEqual(actions([pr(9), pr(8), pr(10, { behindBy: 0 })]), ["8:update", "9:update", "10:skip"]);
});

test("every plan carries a reason a log line can print", () => {
  for (const plan of planUpdates([pr(1), pr(2, { isDraft: true }), pr(3, { mergeable: "CONFLICTING" })])) {
    assert.ok(plan.reason.length > 0, `#${plan.number}`);
  }
});

const verdict = (state: CommitStatus["state"]): CommitStatus => ({
  context: "factory/verdict",
  state,
  description: "3/3 acceptance criteria met",
  target_url: "https://example.test/run/1",
});

test("a passing verdict on the old head is carried to the new head with its provenance", () => {
  const carried = carriedVerdict([verdict("success")], "aaaaaaa1bbbbbbb2");
  assert.deepEqual(carried, {
    context: "factory/verdict",
    state: "success",
    description: "3/3 acceptance criteria met (carried from aaaaaaa by update-branch)",
    target_url: "https://example.test/run/1",
  });
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
  const carried = carriedVerdict([long], "aaaaaaa1");
  const description = carried?.description ?? "";
  assert.ok(description.length <= 140 && description.length > 40);
  assert.ok(description.endsWith("(carried from aaaaaaa by update-branch)"));
});
