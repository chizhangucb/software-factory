import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type DispatchIssue,
  fromGitHub,
  issuesClosedByPrs,
  selectForDispatch,
  whySkipped,
} from "./select.ts";

const ticket = (
  number: number,
  overrides: Partial<DispatchIssue> = {},
): DispatchIssue => ({
  number,
  labels: ["ready-for-agent"],
  assigned: false,
  openBlockers: 0,
  hasOpenPr: false,
  ...overrides,
});

const numbers = (issues: readonly DispatchIssue[]): number[] =>
  selectForDispatch(issues).map((issue) => issue.number);

test("a ready ticket with no blockers, no assignee, and no run state is dispatched", () => {
  assert.deepEqual(numbers([ticket(1)]), [1]);
  assert.equal(whySkipped(ticket(1)), undefined);
});

test("only the dependent of a closed blocker is dispatched, not the rest of the chain", () => {
  // A closed, B blocked by A (now free), C blocked by B (still open).
  const b = ticket(2, { openBlockers: 0 });
  const c = ticket(3, { openBlockers: 1 });
  assert.deepEqual(numbers([b, c]), [2]);
  assert.equal(whySkipped(c), "1 open blocker");
});

test("a ticket with an open blocker is never dispatched", () => {
  assert.deepEqual(numbers([ticket(1, { openBlockers: 2 })]), []);
});

test("a ticket without ready-for-agent is not a dispatch candidate", () => {
  assert.deepEqual(numbers([ticket(1, { labels: [] })]), []);
  assert.equal(whySkipped(ticket(1, { labels: ["bug"] })), "no ready-for-agent");
});

test("ready-for-human and needs-triage are refused even with ready-for-agent", () => {
  const human = ticket(1, { labels: ["ready-for-agent", "ready-for-human"] });
  const triage = ticket(2, { labels: ["needs-triage", "ready-for-agent"] });
  assert.deepEqual(numbers([human, triage]), []);
  assert.equal(whySkipped(human), "refused: ready-for-human");
  assert.equal(whySkipped(triage), "refused: needs-triage");
});

test("an assigned ticket is left to its assignee", () => {
  assert.deepEqual(numbers([ticket(1, { assigned: true })]), []);
});

test("factory state labels mean the ticket is already in the factory", () => {
  for (const state of [
    "agent:implement",
    "agent:in-progress",
    "agent:review",
    "agent:blocked",
    "needs-human",
  ]) {
    const issue = ticket(1, { labels: ["ready-for-agent", state] });
    assert.deepEqual(numbers([issue]), [], state);
    assert.equal(whySkipped(issue), `already in the factory: ${state}`);
  }
});

test("a ticket that an open PR already closes is skipped", () => {
  assert.deepEqual(numbers([ticket(1, { hasOpenPr: true })]), []);
});

test("a spec with sub-issues is not a ticket", () => {
  const spec = ticket(9, { subIssues: 3 });
  assert.deepEqual(numbers([spec]), []);
  assert.equal(whySkipped(spec), "has sub-issues, not a ticket");
});

test("selection keeps the tracker's order and returns whole issues", () => {
  const issues = [ticket(5), ticket(3, { openBlockers: 1 }), ticket(8)];
  assert.deepEqual(selectForDispatch(issues), [issues[0], issues[2]]);
});

test("issuesClosedByPrs reads closing keywords from open PR bodies", () => {
  const closed = issuesClosedByPrs([
    { number: 20, body: "Closes #4\n\nImplemented by the factory." },
    { number: 21, body: "fixes #7 and Resolves: #8" },
    { number: 22, body: "See #9 for context" },
    { number: 23, body: null },
  ]);
  assert.deepEqual([...closed].sort(), [4, 7, 8]);
});

test("fromGitHub maps the REST issue shape and drops pull requests", () => {
  const raw = [
    {
      number: 1,
      labels: [{ name: "ready-for-agent" }, { name: "enhancement" }],
      assignees: [],
      issue_dependencies_summary: { blocked_by: 0, total_blocked_by: 1 },
      sub_issues_summary: { total: 0 },
    },
    {
      number: 2,
      labels: [{ name: "ready-for-agent" }],
      assignees: [{ login: "chi" }],
      issue_dependencies_summary: { blocked_by: 1, total_blocked_by: 1 },
      sub_issues_summary: { total: 2 },
    },
    { number: 3, labels: [], assignees: [], pull_request: { url: "x" } },
    { number: 4, labels: [{ name: "ready-for-agent" }] },
  ];
  assert.deepEqual(fromGitHub(raw, new Set([1])), [
    {
      number: 1,
      labels: ["ready-for-agent", "enhancement"],
      assigned: false,
      openBlockers: 0,
      subIssues: 0,
      hasOpenPr: true,
    },
    {
      number: 2,
      labels: ["ready-for-agent"],
      assigned: true,
      openBlockers: 1,
      subIssues: 2,
      hasOpenPr: false,
    },
    {
      number: 4,
      labels: ["ready-for-agent"],
      assigned: false,
      openBlockers: 0,
      subIssues: 0,
      hasOpenPr: false,
    },
  ]);
});
