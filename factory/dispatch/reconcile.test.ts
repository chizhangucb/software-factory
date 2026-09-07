import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DEADLINES,
  type Decision,
  type PrState,
  type Run,
  type Snapshot,
  type TicketState,
  marksFromTimeline,
  prFromGitHub,
  reconcile,
  roleFromJobs,
  runFromGitHub,
  runsFor,
  stateSinceFromTimeline,
  ticketFromGitHub,
} from "./reconcile.ts";

const NOW = "2026-09-07T20:00:00Z";
const minutesAgo = (m: number): string => new Date(Date.parse(NOW) - m * 60_000).toISOString();

const ticket = (number: number, overrides: Partial<TicketState> = {}): TicketState => ({
  number,
  title: `Ticket ${number}`,
  labels: ["ready-for-agent", "agent:in-progress"],
  stateSince: minutesAgo(20),
  marks: [],
  ...overrides,
});

const pr = (number: number, overrides: Partial<PrState> = {}): PrState => ({
  number,
  title: `Fix #${number - 10}: thing`,
  headRef: `agent/issue-${number - 10}-thing`,
  headSha: "abcdef1234567890",
  labels: [],
  autoMerge: true,
  factory: true,
  closes: number - 10,
  verdict: "success",
  behindBy: 0,
  headSince: minutesAgo(60),
  stateSince: undefined,
  marks: [],
  ...overrides,
});

const run = (id: number, overrides: Partial<Run> = {}): Run => ({
  id,
  event: "issues",
  title: "Ticket 1",
  headBranch: "main",
  status: "completed",
  conclusion: "success",
  createdAt: minutesAgo(10),
  updatedAt: overrides.createdAt ?? minutesAgo(10),
  role: "implement",
  ...overrides,
});

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  now: NOW,
  base: "main",
  issues: [],
  prs: [],
  runs: [],
  ...overrides,
});

const repairs = (decisions: readonly Decision[]): Decision[] =>
  decisions.filter((d) => d.action.type !== "none");

const only = (decisions: readonly Decision[]): Decision => {
  assert.equal(decisions.length, 1, decisions.map((d) => d.log).join("\n"));
  return decisions[0]!;
};

test("a healthy snapshot produces no repairs, and a second pass over it none either", () => {
  const healthy = snapshot({
    issues: [ticket(1, { labels: ["ready-for-agent"] }), ticket(2, { labels: [] })],
    prs: [pr(11, { autoMerge: false }), pr(12, { verdict: "success", behindBy: 0 })],
    runs: [run(100, { role: "dispatch", event: "schedule", title: "factory" })],
  });
  assert.deepEqual(repairs(reconcile(healthy, DEFAULT_DEADLINES)), []);
  assert.deepEqual(repairs(reconcile(healthy, DEFAULT_DEADLINES)), []);
});

test("a ticket in agent:in-progress with no run past the deadline is re-dispatched as miss 1", () => {
  const d = only(reconcile(snapshot({ issues: [ticket(1)] }), DEFAULT_DEADLINES));
  assert.deepEqual(d.subject, { kind: "issue", number: 1 });
  assert.equal(d.action.type, "relabel");
  assert.deepEqual(d.action.type === "relabel" && d.action.remove, ["agent:in-progress"]);
  assert.equal(d.action.type === "relabel" && d.action.add, "agent:implement");
  assert.equal(d.action.type === "relabel" && d.action.miss, 1);
  assert.match(d.log, /#1 \(issue\) agent:in-progress since .*20 min ago, deadline 15 min, no implement run: re-add agent:implement \(miss 1\)/);
  assert.match(d.comment ?? "", /^<!-- factory:sweep miss=1 -->/);
});

test("a ticket in agent:implement with no run past the deadline gets the label removed and added again so the event fires", () => {
  const d = only(reconcile(snapshot({ issues: [ticket(1, { labels: ["ready-for-agent", "agent:implement"] })] }), DEFAULT_DEADLINES));
  assert.deepEqual(d.action, { type: "relabel", remove: ["agent:implement"], add: "agent:implement", miss: 1 });
});

test("the second miss on the same stranding escalates to needs-human with a comment", () => {
  const stranded = ticket(1, { stateSince: minutesAgo(20), marks: [{ miss: 1, at: minutesAgo(19) }] });
  const d = only(reconcile(snapshot({ issues: [stranded] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "escalate");
  assert.deepEqual(d.action.type === "escalate" && d.action.remove, ["agent:in-progress"]);
  assert.equal(d.action.type === "escalate" && d.action.add, "needs-human");
  assert.match(d.log, /second miss: escalate to needs-human/);
  assert.match(d.comment ?? "", /needs-human/);
});

test("a mark from an older stranding does not count: the label was re-applied after it", () => {
  const stranded = ticket(1, { stateSince: minutesAgo(20), marks: [{ miss: 1, at: minutesAgo(200) }] });
  const d = only(reconcile(snapshot({ issues: [stranded] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "relabel");
  assert.equal(d.action.type === "relabel" && d.action.miss, 1);
});

test("a ticket within its deadline is left alone", () => {
  const d = only(reconcile(snapshot({ issues: [ticket(1, { stateSince: minutesAgo(5) })] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "none");
  assert.match(d.log, /5 min ago, deadline 15 min: within deadline/);
});

test("deadlines are inputs: a shorter stuck deadline repairs sooner", () => {
  const d = only(reconcile(snapshot({ issues: [ticket(1, { stateSince: minutesAgo(5) })] }), { ...DEFAULT_DEADLINES, stuckMinutes: 2 }));
  assert.equal(d.action.type, "relabel");
  assert.match(d.log, /deadline 2 min/);
});

test("a live implement run for the ticket covers it", () => {
  const live = run(100, { status: "in_progress", conclusion: null, createdAt: minutesAgo(25) });
  const d = only(reconcile(snapshot({ issues: [ticket(1)], runs: [live] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "none");
  assert.match(d.log, /run 100 live/);
});

test("a queued run counts as live, and a run for another ticket does not cover this one", () => {
  const queued = run(100, { status: "queued", conclusion: null, title: "Ticket 1" });
  const other = run(101, { status: "in_progress", conclusion: null, title: "Ticket 2" });
  const d1 = only(reconcile(snapshot({ issues: [ticket(1)], runs: [queued] }), DEFAULT_DEADLINES));
  assert.equal(d1.action.type, "none");
  const d2 = only(reconcile(snapshot({ issues: [ticket(1)], runs: [other] }), DEFAULT_DEADLINES));
  assert.equal(d2.action.type, "relabel");
});

test("a dispatch run on the same issue title is not an implement run", () => {
  const dispatch = run(100, { status: "in_progress", conclusion: null, role: "dispatch" });
  const d = only(reconcile(snapshot({ issues: [ticket(1)], runs: [dispatch] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "relabel");
});

test("a run whose jobs could not be read is treated as covering while live", () => {
  const unknown = run(100, { status: "in_progress", conclusion: null, role: undefined });
  const d = only(reconcile(snapshot({ issues: [ticket(1)], runs: [unknown] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "none");
});

test("a ticket whose only run was cancelled by slot contention is re-dispatched without spending a miss", () => {
  const cancelled = run(100, { conclusion: "cancelled", createdAt: minutesAgo(19) });
  const stranded = ticket(1, { labels: ["ready-for-agent", "agent:implement"], marks: [{ miss: 1, at: minutesAgo(19) }] });
  const d = only(reconcile(snapshot({ issues: [stranded], runs: [cancelled] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "relabel");
  assert.equal(d.action.type === "relabel" && d.action.miss, 1);
  assert.match(d.log, /run 100 cancelled/);
});

test("a completed run that left the label behind counts as a miss", () => {
  const failed = run(100, { conclusion: "failure", createdAt: minutesAgo(19) });
  const d = only(reconcile(snapshot({ issues: [ticket(1, { labels: ["agent:implement"] })], runs: [failed] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "relabel");
  assert.equal(d.action.type === "relabel" && d.action.miss, 1);
  assert.match(d.log, /run 100 ended failure and left agent:implement/);
});

test("a run that finished moments ago is still settling, not a miss", () => {
  const fresh = run(100, { conclusion: "success", createdAt: minutesAgo(3) });
  const d = only(reconcile(snapshot({ issues: [ticket(1, { labels: ["agent:implement"] })], runs: [fresh] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "none");
  assert.match(d.log, /run 100 ended success 3 min ago, settling/);
});

test("a ticket whose state label time is unknown is treated as overdue", () => {
  const d = only(reconcile(snapshot({ issues: [ticket(1, { stateSince: undefined })] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "relabel");
  assert.match(d.log, /since unknown/);
});

test("parked tickets (agent:blocked, needs-human) are never touched", () => {
  const blocked = ticket(1, { labels: ["agent:implement", "agent:blocked"] });
  const human = ticket(2, { labels: ["agent:in-progress", "needs-human"] });
  const ds = reconcile(snapshot({ issues: [blocked, human] }), DEFAULT_DEADLINES);
  assert.deepEqual(repairs(ds), []);
  assert.match(ds[0]!.log, /parked: agent:blocked/);
  assert.match(ds[1]!.log, /parked: needs-human/);
});

test("a PR carrying agent:review with no review run past the deadline gets the label again", () => {
  const stuck = pr(11, { labels: ["agent:review"], stateSince: minutesAgo(20) });
  const d = only(reconcile(snapshot({ prs: [stuck] }), DEFAULT_DEADLINES));
  assert.deepEqual(d.subject, { kind: "pr", number: 11 });
  assert.deepEqual(d.action, { type: "relabel", remove: ["agent:review"], add: "agent:review", miss: 1 });
  assert.match(d.log, /#11 \(pr\) agent:review since .*no review run: re-add agent:review \(miss 1\)/);
});

test("a live review run on the PR's head branch covers it; one on another branch does not", () => {
  const stuck = pr(11, { labels: ["agent:review"], stateSince: minutesAgo(20) });
  const mine = run(100, { event: "pull_request_target", headBranch: stuck.headRef, role: "review", status: "in_progress", conclusion: null });
  const other = run(101, { event: "pull_request_target", headBranch: "agent/issue-9-x", role: "review", status: "in_progress", conclusion: null });
  assert.equal(only(reconcile(snapshot({ prs: [stuck], runs: [mine] }), DEFAULT_DEADLINES)).action.type, "none");
  assert.equal(only(reconcile(snapshot({ prs: [stuck], runs: [other] }), DEFAULT_DEADLINES)).action.type, "relabel");
});

test("a PR's second miss escalates the PR and its ticket", () => {
  const stuck = pr(11, { labels: ["agent:review"], stateSince: minutesAgo(20), marks: [{ miss: 1, at: minutesAgo(19) }] });
  const d = only(reconcile(snapshot({ prs: [stuck] }), DEFAULT_DEADLINES));
  assert.equal(d.action.type, "escalate");
  assert.equal(d.action.type === "escalate" && d.action.ticket, 1);
});

test("a PR in agent:in-progress with no live run is sent back to review; a live implement-pr run covers it", () => {
  const stale = pr(11, { labels: ["agent:in-progress"], stateSince: minutesAgo(20) });
  const d = only(reconcile(snapshot({ prs: [stale] }), DEFAULT_DEADLINES));
  assert.deepEqual(d.action, { type: "relabel", remove: ["agent:in-progress"], add: "agent:review", miss: 1 });
  const live = run(100, { event: "pull_request_target", headBranch: stale.headRef, role: "implement-pr", status: "in_progress", conclusion: null });
  assert.equal(only(reconcile(snapshot({ prs: [stale], runs: [live] }), DEFAULT_DEADLINES)).action.type, "none");
});

test("a PR carrying agent:implement expects an implement-pr run", () => {
  const stuck = pr(11, { labels: ["agent:implement"], stateSince: minutesAgo(20) });
  const d = only(reconcile(snapshot({ prs: [stuck] }), DEFAULT_DEADLINES));
  assert.deepEqual(d.action, { type: "relabel", remove: ["agent:implement"], add: "agent:implement", miss: 1 });
});

test("an auto-merge factory PR with no verdict past the deadline gets agent:review", () => {
  const unjudged = pr(11, { verdict: "none", headSince: minutesAgo(45) });
  const d = only(reconcile(snapshot({ prs: [unjudged] }), DEFAULT_DEADLINES));
  assert.deepEqual(d.action, { type: "relabel", remove: [], add: "agent:review" });
  assert.match(d.log, /#11 \(pr\) auto-merge armed, no factory\/verdict on abcdef1 since .*45 min ago, deadline 30 min: add agent:review/);
});

test("an unjudged PR within the verdict deadline, or with a pending or failed verdict, is left alone", () => {
  const young = pr(11, { verdict: "none", headSince: minutesAgo(10) });
  const pending = pr(12, { verdict: "pending", headSince: minutesAgo(45) });
  const failed = pr(13, { verdict: "failure", headSince: minutesAgo(45) });
  const ds = reconcile(snapshot({ prs: [young, pending, failed] }), DEFAULT_DEADLINES);
  assert.deepEqual(repairs(ds), []);
  assert.match(ds[0]!.log, /within deadline/);
  assert.match(ds[1]!.log, /verdict pending/);
  assert.match(ds[2]!.log, /verdict failure/);
});

test("the verdict rule skips PRs that are not factory PRs, have no auto-merge, or carry an agent label", () => {
  const human = pr(11, { verdict: "none", headSince: minutesAgo(45), factory: false });
  const manual = pr(12, { verdict: "none", headSince: minutesAgo(45), autoMerge: false });
  const reviewing = pr(13, { verdict: "none", headSince: minutesAgo(45), labels: ["agent:review"], stateSince: minutesAgo(1) });
  const ds = reconcile(snapshot({ prs: [human, manual, reviewing] }), DEFAULT_DEADLINES);
  assert.deepEqual(repairs(ds), []);
  assert.equal(ds.filter((d) => d.subject.number === 13).length, 1, "only the review-label rule sees #13");
});

test("a merge-ready PR behind main with no update-branch run in the window gets one dispatched", () => {
  const stale = pr(11, { verdict: "success", behindBy: 2 });
  const d = only(reconcile(snapshot({ prs: [stale] }), DEFAULT_DEADLINES));
  assert.deepEqual(d.action, { type: "dispatch", eventType: "factory-update-branch", pr: 11 });
  assert.match(d.log, /#11 \(pr\) 2 behind main with factory\/verdict success, deadline 30 min, no update-branch run in the window: dispatch factory-update-branch/);
});

test("a recent or live update-branch run (push to main, or the review's dispatch) covers a stale PR", () => {
  const stale = pr(11, { verdict: "success", behindBy: 2 });
  const push = run(100, { event: "push", headBranch: "main", title: "merge something", role: undefined, createdAt: minutesAgo(5) });
  const dispatched = run(101, { event: "repository_dispatch", title: "factory-update-branch", role: undefined, status: "in_progress", conclusion: null, createdAt: minutesAgo(90) });
  const old = run(102, { event: "push", headBranch: "main", role: undefined, createdAt: minutesAgo(40) });
  assert.equal(only(reconcile(snapshot({ prs: [stale], runs: [push] }), DEFAULT_DEADLINES)).action.type, "none");
  assert.equal(only(reconcile(snapshot({ prs: [stale], runs: [dispatched] }), DEFAULT_DEADLINES)).action.type, "none");
  assert.equal(only(reconcile(snapshot({ prs: [stale], runs: [old] }), DEFAULT_DEADLINES)).action.type, "dispatch");
});

test("every decision names its subject, state, deadline, and action in one log line", () => {
  const ds = reconcile(
    snapshot({
      issues: [ticket(1)],
      prs: [pr(11, { labels: ["agent:review"], stateSince: minutesAgo(1) }), pr(12, { verdict: "none", headSince: minutesAgo(45) })],
    }),
    DEFAULT_DEADLINES,
  );
  assert.equal(ds.length, 3);
  for (const d of ds) {
    assert.match(d.log, /^#\d+ \((issue|pr)\) .*deadline \d+ min.*: /);
    assert.equal(d.log.split("\n").length, 1);
  }
});

test("runsFor matches issues runs by title and pull_request_target runs by head branch", () => {
  const runs = [
    run(1, { event: "issues", title: "Ticket 1" }),
    run(2, { event: "issues", title: "Ticket 1 " }),
    run(3, { event: "pull_request_target", headBranch: "agent/issue-1-thing", title: "Fix #1: thing" }),
    run(4, { event: "pull_request", headBranch: "agent/issue-1-thing", title: "Fix #1: thing" }),
  ];
  assert.deepEqual(runsFor({ kind: "issue", title: "Ticket 1" }, runs).map((r) => r.id), [1, 2]);
  assert.deepEqual(runsFor({ kind: "pr", headRef: "agent/issue-1-thing" }, runs).map((r) => r.id), [3]);
});

test("roleFromJobs reads the called job's name and ignores skipped caller jobs", () => {
  assert.equal(roleFromJobs([{ name: "implement / slot", conclusion: "success" }, { name: "implement / implement", conclusion: null }, { name: "dispatch", conclusion: "skipped" }]), "implement");
  assert.equal(roleFromJobs([{ name: "review / slot", conclusion: "success" }, { name: "review / review", conclusion: "success" }]), "review");
  assert.equal(roleFromJobs([{ name: "implement-pr / implement-pr", conclusion: "cancelled" }]), "implement-pr");
  assert.equal(roleFromJobs([{ name: "dispatch / dispatch", conclusion: "success" }, { name: "implement", conclusion: "skipped" }]), "dispatch");
  assert.equal(roleFromJobs([{ name: "implement", conclusion: "skipped" }, { name: "review", conclusion: "skipped" }]), "none");
  assert.equal(roleFromJobs([{ name: "update-branch / update", conclusion: "success" }]), "update-branch");
});

test("runFromGitHub maps the REST run shape", () => {
  assert.deepEqual(
    runFromGitHub({ id: 5, event: "pull_request_target", display_title: "Fix #1", head_branch: "agent/x", status: "queued", conclusion: null, created_at: "2026-09-07T19:00:00Z", updated_at: "2026-09-07T19:01:00Z" }),
    { id: 5, event: "pull_request_target", title: "Fix #1", headBranch: "agent/x", status: "queued", conclusion: null, createdAt: "2026-09-07T19:00:00Z", updatedAt: "2026-09-07T19:01:00Z" },
  );
});

test("ticketFromGitHub and prFromGitHub map the tracker shapes and detect factory PRs", () => {
  assert.deepEqual(ticketFromGitHub({ number: 3, title: "T", labels: [{ name: "agent:implement" }] }), { number: 3, title: "T", labels: ["agent:implement"], stateSince: undefined, marks: [] });
  const raw = {
    number: 11, title: "Fix #3: T", headRefName: "agent/issue-3-t", headRefOid: "abc", labels: [{ name: "agent:review" }],
    autoMergeRequest: { mergeMethod: "SQUASH" }, body: "Closes #3\n\nImplemented by the software factory. Run: x",
  };
  const mapped = prFromGitHub(raw);
  assert.equal(mapped.autoMerge, true);
  assert.equal(mapped.factory, true);
  assert.equal(mapped.closes, 3);
  assert.equal(prFromGitHub({ ...raw, headRefName: "feature/x", body: "hand made", autoMergeRequest: null }).factory, false);
  assert.equal(prFromGitHub({ ...raw, headRefName: "feature/x", body: "hand made", autoMergeRequest: null }).autoMerge, false);
});

test("stateSinceFromTimeline finds the latest labeled event; marksFromTimeline reads sweep comments", () => {
  const timeline = [
    { event: "labeled", label: { name: "agent:implement" }, created_at: "2026-09-07T10:00:00Z" },
    { event: "unlabeled", label: { name: "agent:implement" }, created_at: "2026-09-07T10:01:00Z" },
    { event: "commented", body: "<!-- factory:sweep miss=1 -->\nReconciler: ...", created_at: "2026-09-07T10:02:00Z" },
    { event: "commented", body: "just a comment", created_at: "2026-09-07T10:03:00Z" },
    { event: "labeled", label: { name: "agent:implement" }, created_at: "2026-09-07T11:00:00Z" },
  ];
  assert.equal(stateSinceFromTimeline(timeline, "agent:implement"), "2026-09-07T11:00:00Z");
  assert.equal(stateSinceFromTimeline(timeline, "agent:review"), undefined);
  assert.deepEqual(marksFromTimeline(timeline), [{ miss: 1, at: "2026-09-07T10:02:00Z" }]);
});
