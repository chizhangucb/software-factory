import assert from "node:assert/strict";
import { test } from "node:test";

import { HOLD_LABEL, HOLD_LABELS } from "../lib/labels.ts";
import { trustPolicy } from "../lib/trusted-authors.ts";
import {
  type DispatchIssue,
  fromGitHub,
  issuesClosedByPrs,
  selectForDispatch,
  whyNotDispatchableNow,
  whySkipped,
} from "./select.ts";

/** The default every target starts on: the repo owner alone. */
const OWNER_ONLY = trustPolicy("OWNER");

const ticket = (
  number: number,
  overrides: Partial<DispatchIssue> = {},
): DispatchIssue => ({
  number,
  labels: ["ready-for-agent"],
  assigned: false,
  openBlockers: 0,
  hasOpenPr: false,
  authorAssociation: "OWNER",
  ...overrides,
});

const numbers = (issues: readonly DispatchIssue[]): number[] =>
  selectForDispatch(issues, OWNER_ONLY).map((issue) => issue.number);

test("a ready ticket with no blockers, no assignee, and no run state is dispatched", () => {
  assert.deepEqual(numbers([ticket(1)]), [1]);
  assert.equal(whySkipped(ticket(1), OWNER_ONLY), undefined);
});

test("only the dependent of a closed blocker is dispatched, not the rest of the chain", () => {
  // A closed, B blocked by A (now free), C blocked by B (still open).
  const b = ticket(2, { openBlockers: 0 });
  const c = ticket(3, { openBlockers: 1 });
  assert.deepEqual(numbers([b, c]), [2]);
  assert.equal(whySkipped(c, OWNER_ONLY), "1 open blocker");
});

test("a ticket with an open blocker is never dispatched", () => {
  assert.deepEqual(numbers([ticket(1, { openBlockers: 2 })]), []);
});

test("a ticket without ready-for-agent is not a dispatch candidate", () => {
  assert.deepEqual(numbers([ticket(1, { labels: [] })]), []);
  assert.equal(whySkipped(ticket(1, { labels: ["bug"] }), OWNER_ONLY), "no ready-for-agent");
});

test("every hold label holds a ticket back, however ready it says it is", () => {
  // The hold set is the label vocabulary's, not the dispatcher's own: #169 put
  // it in `lib/labels.ts` so a reader of the vocabulary sees what stops a
  // dispatch without reading `select.ts`. Reading it from there is also what
  // fails this test if a second copy ever grows back here.
  for (const label of HOLD_LABELS) {
    const held = ticket(1, { labels: ["ready-for-agent", label] });
    assert.deepEqual(numbers([held]), []);
    assert.equal(whySkipped(held, OWNER_ONLY), `held: ${label}`);
  }
});

test("the hold is the only thing stopping a ticket that is otherwise ready to go", () => {
  // One ticket, one label apart, so what the hold does is the only difference
  // between the two answers. That is the case the label exists for: a ticket
  // with nothing wrong with it that a human is holding anyway.
  const ready = ticket(7, { labels: ["ready-for-agent"] });
  const held = { ...ready, labels: [...ready.labels, HOLD_LABEL] };
  assert.equal(whySkipped(ready, OWNER_ONLY), undefined);
  assert.equal(whySkipped(held, OWNER_ONLY), `held: ${HOLD_LABEL}`);
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
    assert.equal(whySkipped(issue, OWNER_ONLY), `already in the factory: ${state}`);
  }
});

test("a ticket that an open PR already closes is skipped", () => {
  assert.deepEqual(numbers([ticket(1, { hasOpenPr: true })]), []);
});

test("a spec with sub-issues is not a ticket", () => {
  const spec = ticket(9, { subIssues: 3 });
  assert.deepEqual(numbers([spec]), []);
  assert.equal(whySkipped(spec, OWNER_ONLY), "has sub-issues, not a ticket");
});

test("selection keeps the tracker's order and returns whole issues", () => {
  const issues = [ticket(5), ticket(3, { openBlockers: 1 }), ticket(8)];
  assert.deepEqual(selectForDispatch(issues, OWNER_ONLY), [issues[0], issues[2]]);
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
      author_association: "OWNER",
      issue_dependencies_summary: { blocked_by: 0, total_blocked_by: 1 },
      sub_issues_summary: { total: 0 },
    },
    {
      number: 2,
      labels: [{ name: "ready-for-agent" }],
      assignees: [{ login: "chi" }],
      author_association: "COLLABORATOR",
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
      authorAssociation: "OWNER",
    },
    {
      number: 2,
      labels: ["ready-for-agent"],
      assigned: true,
      openBlockers: 1,
      subIssues: 2,
      hasOpenPr: false,
      authorAssociation: "COLLABORATOR",
    },
    {
      number: 4,
      labels: ["ready-for-agent"],
      assigned: false,
      openBlockers: 0,
      subIssues: 0,
      hasOpenPr: false,
      authorAssociation: "NONE",
    },
  ]);
});

test("re-reading an issue before labeling catches a close or a new blocker since the snapshot", () => {
  // The issues list is eventually consistent: #65 and #67 were labeled seconds after closing (#19).
  const raw = (over: Record<string, unknown>) => ({
    number: 67,
    state: "open",
    labels: [{ name: "ready-for-agent" }],
    assignees: [],
    author_association: "OWNER",
    issue_dependencies_summary: { blocked_by: 0 },
    ...over,
  });
  const none = new Set<number>();
  assert.equal(whyNotDispatchableNow(raw({}), none, OWNER_ONLY), undefined);
  assert.equal(whyNotDispatchableNow(raw({ state: "closed" }), none, OWNER_ONLY), "closed since the snapshot");
  assert.equal(whyNotDispatchableNow(raw({ issue_dependencies_summary: { blocked_by: 1 } }), none, OWNER_ONLY), "1 open blocker");
  assert.equal(whyNotDispatchableNow(raw({}), new Set([67]), OWNER_ONLY), "an open PR already closes it");
  assert.equal(
    whyNotDispatchableNow(raw({ labels: [{ name: "ready-for-agent" }, { name: "agent:in-progress" }] }), none, OWNER_ONLY),
    "already in the factory: agent:in-progress",
  );
});

test("the re-read applies the same trust list the selection did", () => {
  const raw = { number: 67, state: "open", labels: [{ name: "ready-for-agent" }], assignees: [], author_association: "COLLABORATOR", issue_dependencies_summary: { blocked_by: 0 } };
  const none = new Set<number>();
  assert.equal(whyNotDispatchableNow(raw, none, OWNER_ONLY), "untrusted author: COLLABORATOR");
  assert.equal(whyNotDispatchableNow(raw, none, trustPolicy("OWNER,COLLABORATOR")), undefined);
});

test("a ticket written by someone without write access is not dispatched", () => {
  // chronicle is public: anyone can open an issue, and the ticket is what the
  // implementer executes. Only the owner's own tickets are trusted by default.
  const outsider = ticket(1, { authorAssociation: "NONE" });
  assert.deepEqual(numbers([outsider]), []);
  assert.equal(whySkipped(outsider, OWNER_ONLY), "untrusted author: NONE");
});

test("a wider trust list lets in a ticket the default would park", () => {
  const member = ticket(1, { authorAssociation: "COLLABORATOR" });
  const trusted = trustPolicy("OWNER,COLLABORATOR");
  assert.deepEqual(selectForDispatch([member], trusted).map((i) => i.number), [1]);
  assert.equal(whySkipped(member, trusted), undefined);
});

test("fromGitHub carries author_association, and an issue with none is untrusted", () => {
  const [owned, anonymous] = fromGitHub(
    [
      { number: 1, labels: [{ name: "ready-for-agent" }], author_association: "OWNER" },
      { number: 2, labels: [{ name: "ready-for-agent" }] },
    ],
    new Set(),
  );
  assert.equal(owned.authorAssociation, "OWNER");
  assert.equal(anonymous.authorAssociation, "NONE");
  assert.deepEqual(numbers([owned, anonymous]), [1]);
});
