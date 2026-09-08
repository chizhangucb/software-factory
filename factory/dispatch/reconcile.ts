/**
 * Reconciler (#35): repair factory states stuck past their deadline.
 *
 * Every factory transition is event-driven (a label, a PR event, a push); a
 * lost or cancelled event leaves a ticket or PR stranded. The dispatcher's
 * sweep reads real state and repairs anything past its deadline, so a lost
 * event costs at most one sweep. Pure: a snapshot in (open issues and PRs
 * with labels and timestamps, the recent run list, the verdict and
 * staleness of auto-merge PRs), a decision per candidate out. `sweep.ts`
 * builds the snapshot and applies the repairs.
 *
 * Stuck states and repairs:
 * - ticket in agent:implement or agent:in-progress with no live implement
 *   run: re-add agent:implement (remove then add, so the event fires);
 *   second miss on the same stranding escalates to needs-human. Escalation
 *   here leaves the same labels as the retry handler's (#50,
 *   `factory/retry/labels.ts`): needs-human alone.
 * - PR in agent:review (or agent:implement, agent:in-progress) with no live
 *   review (implement-pr) run: same, with agent:review.
 * - factory PR with auto-merge armed and no factory/verdict on its head:
 *   add agent:review.
 * - merge-ready PR behind main with no update-branch run in the window:
 *   dispatch factory-update-branch.
 * A run cancelled by slot contention (#17) is re-dispatched but not counted
 * as a miss: the event was not lost, the slot was full.
 *
 * Miss count lives in a marker comment on the subject, `<!-- factory:sweep
 * miss=<n> -->`, read back from the timeline; a marker older than the
 * current state label belongs to an earlier stranding and does not count.
 *
 * Imports use explicit `.ts` so the job can run on bare
 * `node --experimental-strip-types` without installing the engine.
 */
import { escalationLabels, ESCALATION_LABEL } from "../retry/labels.ts";
import { issuesClosedByPrs } from "./select.ts";

export type Deadlines = {
  /** A ticket or PR label with no live run for this long is stuck. */
  stuckMinutes: number;
  /** An auto-merge PR head with no factory/verdict for this long is unjudged. */
  verdictMinutes: number;
  /** A merge-ready PR behind main with no update-branch run in this long needs one. */
  updateMinutes: number;
};

export const DEFAULT_DEADLINES: Deadlines = { stuckMinutes: 15, verdictMinutes: 30, updateMinutes: 30 };

export { ESCALATION_LABEL };
export const PARKED_LABELS = ["agent:blocked", ESCALATION_LABEL] as const;
export const UPDATE_BRANCH_EVENT = "factory-update-branch";
export const SWEEP_MARK = /^<!-- factory:sweep miss=(\d+) -->/;

/** Label timestamps and run timestamps are written by different actors; this much skew is noise. */
const SLACK_MS = 2 * 60_000;
const MAX_MISSES = 2;

export type RunRole = "implement" | "review" | "implement-pr" | "dispatch" | "update-branch" | "gate" | "audit" | "none";

export type Run = {
  id: number;
  event: string;
  /** `display_title`: the issue title on `issues` events, the PR title on `pull_request_target`. */
  title: string;
  /** The PR head on `pull_request_target`, the pushed branch on `push`, main otherwise. */
  headBranch: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  /** From the run's job names; undefined when the jobs were not read (treated as covering while live). */
  role?: RunRole;
};

export type SweepMark = { miss: number; at: string };

export type TicketState = {
  number: number;
  title: string;
  labels: readonly string[];
  /** When the current agent:* label was applied; undefined when unknown (treated as overdue). */
  stateSince: string | undefined;
  marks: readonly SweepMark[];
};

export type VerdictState = "none" | "pending" | "success" | "failure" | "error";

export type PrState = {
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  labels: readonly string[];
  autoMerge: boolean;
  /** Opened by the factory: an agent/ branch or the implementer's PR body. */
  factory: boolean;
  /** The ticket the body closes, when it names one. */
  closes: number | undefined;
  /** factory/verdict on the head; undefined when not read. */
  verdict?: VerdictState;
  /** Commits on main the head lacks; undefined when not read. */
  behindBy?: number;
  /** The later of the PR's creation and its head commit; undefined when not read. */
  headSince?: string;
  stateSince: string | undefined;
  marks: readonly SweepMark[];
};

export type Snapshot = {
  now: string;
  base: string;
  issues: readonly TicketState[];
  prs: readonly PrState[];
  runs: readonly Run[];
  /** The sweep's own run, linked from comments. */
  sweepUrl?: string;
};

export type Subject = { kind: "issue" | "pr"; number: number };

export type Action =
  | { type: "none" }
  | { type: "relabel"; remove: string[]; add: string; miss?: number }
  | { type: "escalate"; remove: string[]; add: typeof ESCALATION_LABEL; ticket?: number }
  | { type: "dispatch"; eventType: typeof UPDATE_BRANCH_EVENT; pr: number };

export type Decision = {
  subject: Subject;
  action: Action;
  /** One line: subject, state, deadline, and the action or why none. */
  log: string;
  /** Posted on the subject when the action is applied. */
  comment?: string;
};

const minutesSince = (now: number, iso: string): number => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
const isLive = (run: Run): boolean => run.status !== "completed";
const agentLabels = (labels: readonly string[]): string[] => labels.filter((l) => l.startsWith("agent:"));
const byNewest = (a: Run, b: Run): number => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/** The runs that belong to a ticket (by title on `issues` events) or a PR (by head on `pull_request_target`). */
export const runsFor = (
  subject: { kind: "issue"; title: string } | { kind: "pr"; headRef: string },
  runs: readonly Run[],
): Run[] =>
  subject.kind === "issue"
    ? runs.filter((r) => r.event === "issues" && r.title.trim() === subject.title.trim())
    : runs.filter((r) => r.event === "pull_request_target" && r.headBranch === subject.headRef);

const isUpdateBranchRun = (run: Run, base: string): boolean =>
  (run.event === "push" && run.headBranch === base) ||
  (run.event === "repository_dispatch" && run.title === UPDATE_BRANCH_EVENT);

type StuckInput = {
  subject: Subject;
  state: string;
  since: string | undefined;
  marks: readonly SweepMark[];
  /** Runs for this subject with a role that would consume the state, or an unknown role. */
  runs: readonly Run[];
  expected: string;
  /** The subject's labels: a relabel clears the agent:* ones, an escalation clears more. */
  labels: readonly string[];
  add: string;
  ticket?: number;
};

const markComment = (input: StuckInput, cause: string, miss: number, counted: boolean, deadline: number, url?: string): string => {
  const count = counted
    ? `Miss ${miss} of ${MAX_MISSES}: a second miss escalates to \`${ESCALATION_LABEL}\`.`
    : `Not counted as a miss (a cancelled run is slot contention, not a lost event); the count stays at ${miss}.`;
  return [
    `<!-- factory:sweep miss=${miss} -->`,
    `Reconciler: \`${input.state}\` since ${input.since ?? "an unknown time"}, ${cause} after the ${deadline} min deadline. Re-added \`${input.add}\`. ${count}`,
    url ? `\nSweep: ${url}` : "",
  ].join("\n");
};

const escalationComment = (input: StuckInput, cause: string, deadline: number, url?: string): string => {
  const handBack =
    input.subject.kind === "issue"
      ? `remove \`${ESCALATION_LABEL}\`, then add \`ready-for-agent\` back and the dispatcher picks the ticket up on its next event, or add \`${input.add}\` by hand.`
      : `remove \`${ESCALATION_LABEL}\` here and on the ticket, then add \`${input.add}\` to this PR.`;
  return [
    `## Escalated: \`${ESCALATION_LABEL}\``,
    "",
    `The reconciler gave up on this ${input.subject.kind === "issue" ? "ticket" : "PR"}: \`${input.state}\` since ${input.since ?? "an unknown time"}, ${cause} after the ${deadline} min deadline, and the same after it was re-dispatched once. The event that starts the run was lost twice.`,
    "",
    `- Labels: \`${escalationLabels(input.labels).remove.join("`, `")}\` removed, \`${ESCALATION_LABEL}\` added.`,
    `- To hand it back: ${handBack}`,
    url ? `- Sweep: ${url}` : "",
  ].filter((line) => line !== "").join("\n");
};

const decideStuck = (input: StuckInput, snap: Snapshot, deadline: number): Decision => {
  const now = Date.parse(snap.now);
  const sinceMs = input.since === undefined ? undefined : Date.parse(input.since);
  const age = sinceMs === undefined ? undefined : minutesSince(now, input.since!);
  const head = `#${input.subject.number} (${input.subject.kind}) ${input.state} since ${input.since === undefined ? "unknown" : `${input.since}, ${age} min ago`}, deadline ${deadline} min`;
  const none = (why: string): Decision => ({ subject: input.subject, action: { type: "none" }, log: `${head}: ${why}` });

  const live = input.runs.find(isLive);
  if (live) return none(`run ${live.id} live`);
  if (age !== undefined && age < deadline) return none("within deadline");

  // Only a run that ended after the label went on can have consumed or left it.
  const ended = input.runs
    .filter((r) => !isLive(r) && (sinceMs === undefined || Date.parse(r.updatedAt) >= sinceMs - SLACK_MS))
    .sort(byNewest);
  const latest = ended[0];
  let cause: string;
  let counted: boolean;
  if (latest === undefined) {
    cause = `no ${input.expected}`;
    counted = true;
  } else if (latest.conclusion === "cancelled") {
    cause = `run ${latest.id} cancelled`;
    counted = false;
  } else {
    const endedAgo = minutesSince(now, latest.updatedAt);
    if (endedAgo < deadline) return none(`run ${latest.id} ended ${latest.conclusion} ${endedAgo} min ago, settling`);
    cause = `run ${latest.id} ended ${latest.conclusion} and left ${input.state}`;
    counted = true;
  }

  const previous = input.marks
    .filter((m) => sinceMs === undefined || Date.parse(m.at) >= sinceMs - SLACK_MS)
    .reduce((max, m) => Math.max(max, m.miss), 0);
  if (counted && previous >= MAX_MISSES - 1) {
    const escalation = escalationLabels(input.labels);
    return {
      subject: input.subject,
      action: { type: "escalate", remove: escalation.remove, add: escalation.add, ticket: input.ticket },
      log: `${head}, ${cause}, second miss: escalate to ${ESCALATION_LABEL}`,
      comment: escalationComment(input, cause, deadline, snap.sweepUrl),
    };
  }
  const miss = counted ? previous + 1 : previous;
  return {
    subject: input.subject,
    action: { type: "relabel", remove: agentLabels(input.labels), add: input.add, miss },
    log: `${head}, ${cause}: re-add ${input.add} (miss ${miss})`,
    comment: markComment(input, cause, miss, counted, deadline, snap.sweepUrl),
  };
};

const parkedDecision = (subject: Subject, labels: readonly string[], deadline: number): Decision | undefined => {
  const parked = PARKED_LABELS.find((l) => labels.includes(l));
  if (!parked) return undefined;
  const state = agentLabels(labels).filter((l) => l !== "agent:blocked")[0] ?? parked;
  return { subject, action: { type: "none" }, log: `#${subject.number} (${subject.kind}) ${state}, deadline ${deadline} min: parked: ${parked}` };
};

const decideTicket = (t: TicketState, snap: Snapshot, deadlines: Deadlines): Decision | undefined => {
  const has = (l: string) => t.labels.includes(l);
  if (!has("agent:implement") && !has("agent:in-progress")) return undefined;
  const subject: Subject = { kind: "issue", number: t.number };
  const parked = parkedDecision(subject, t.labels, deadlines.stuckMinutes);
  if (parked) return parked;
  const state = has("agent:in-progress") ? "agent:in-progress" : "agent:implement";
  const runs = runsFor({ kind: "issue", title: t.title }, snap.runs).filter((r) => r.role === undefined || r.role === "implement");
  return decideStuck(
    { subject, state, since: t.stateSince, marks: t.marks, runs, expected: "implement run", labels: t.labels, add: "agent:implement" },
    snap,
    deadlines.stuckMinutes,
  );
};

const PR_STATES: readonly { label: string; roles: readonly RunRole[]; expected: string; add: string }[] = [
  { label: "agent:in-progress", roles: ["review", "implement-pr"], expected: "review or implement-pr run", add: "agent:review" },
  { label: "agent:review", roles: ["review"], expected: "review run", add: "agent:review" },
  { label: "agent:implement", roles: ["implement-pr"], expected: "implement-pr run", add: "agent:implement" },
];

const decidePrLabel = (p: PrState, snap: Snapshot, deadlines: Deadlines): Decision | undefined => {
  const state = PR_STATES.find((s) => p.labels.includes(s.label));
  if (!state) return undefined;
  const subject: Subject = { kind: "pr", number: p.number };
  const parked = parkedDecision(subject, p.labels, deadlines.stuckMinutes);
  if (parked) return parked;
  const runs = runsFor({ kind: "pr", headRef: p.headRef }, snap.runs).filter((r) => r.role === undefined || state.roles.includes(r.role));
  return decideStuck(
    { subject, state: state.label, since: p.stateSince, marks: p.marks, runs, expected: state.expected, labels: p.labels, add: state.add, ticket: p.closes },
    snap,
    deadlines.stuckMinutes,
  );
};

/** Auto-merge factory PRs with no agent on them: judged, or stale behind main, or neither. */
const decidePrMerge = (p: PrState, snap: Snapshot, deadlines: Deadlines): Decision | undefined => {
  if (!p.autoMerge || !p.factory || agentLabels(p.labels).length > 0 || PARKED_LABELS.some((l) => p.labels.includes(l))) return undefined;
  const subject: Subject = { kind: "pr", number: p.number };
  const none = (log: string): Decision => ({ subject, action: { type: "none" }, log });
  const sha = p.headSha.slice(0, 7);
  const now = Date.parse(snap.now);

  if (p.verdict === undefined) return none(`#${p.number} (pr) auto-merge armed, factory/verdict on ${sha} not read, deadline ${deadlines.verdictMinutes} min: skip`);
  if (p.verdict === "none") {
    const age = p.headSince === undefined ? undefined : minutesSince(now, p.headSince);
    const head = `#${p.number} (pr) auto-merge armed, no factory/verdict on ${sha} since ${p.headSince === undefined ? "unknown" : `${p.headSince}, ${age} min ago`}, deadline ${deadlines.verdictMinutes} min`;
    if (age !== undefined && age < deadlines.verdictMinutes) return none(`${head}: within deadline`);
    return { subject, action: { type: "relabel", remove: [], add: "agent:review" }, log: `${head}: add agent:review` };
  }
  if (p.verdict === "pending") return none(`#${p.number} (pr) auto-merge armed, factory/verdict pending on ${sha}, deadline ${deadlines.verdictMinutes} min: reviewer running`);
  if (p.verdict !== "success") return none(`#${p.number} (pr) auto-merge armed, factory/verdict ${p.verdict} on ${sha}, deadline ${deadlines.verdictMinutes} min: the retry handler owns it`);

  const head = `#${p.number} (pr) ${p.behindBy ?? "?"} behind ${snap.base} with factory/verdict success, deadline ${deadlines.updateMinutes} min`;
  if (p.behindBy === undefined) return none(`${head}: behind count not read, skip`);
  if (p.behindBy === 0) return none(`${head}: up to date`);
  const updates = snap.runs.filter((r) => isUpdateBranchRun(r, snap.base));
  const live = updates.find(isLive);
  if (live) return none(`${head}: update-branch run ${live.id} live`);
  const recent = updates.filter((r) => r.conclusion !== "cancelled" && minutesSince(now, r.createdAt) < deadlines.updateMinutes).sort(byNewest)[0];
  if (recent) return none(`${head}: update-branch run ${recent.id} ran ${minutesSince(now, recent.createdAt)} min ago`);
  return {
    subject,
    action: { type: "dispatch", eventType: UPDATE_BRANCH_EVENT, pr: p.number },
    log: `${head}, no update-branch run in the window: dispatch ${UPDATE_BRANCH_EVENT}`,
  };
};

/** One decision per candidate, in tracker order: tickets, then PRs by label, then PRs by merge state. */
export const reconcile = (snap: Snapshot, deadlines: Deadlines): Decision[] => {
  const decisions: Decision[] = [];
  for (const t of snap.issues) {
    const d = decideTicket(t, snap, deadlines);
    if (d) decisions.push(d);
  }
  for (const p of snap.prs) {
    const d = decidePrLabel(p, snap, deadlines) ?? decidePrMerge(p, snap, deadlines);
    if (d) decisions.push(d);
  }
  return decisions;
};

/* Mapping from GitHub's shapes. */

const JOB_ROLES: Record<string, RunRole> = {
  implement: "implement",
  review: "review",
  "implement-pr": "implement-pr",
  dispatch: "dispatch",
  update: "update-branch",
  gate: "gate",
  decide: "audit",
  audit: "audit",
};

/**
 * A run's role from its job names. A reusable workflow's jobs are listed as
 * `<caller job> / <called job>`; a caller job whose `if` was false appears
 * alone (and skipped), so only names with a called part count.
 */
export const roleFromJobs = (jobs: readonly { name: string; conclusion: string | null }[]): RunRole => {
  for (const job of jobs) {
    const parts = job.name.split(" / ");
    if (parts.length < 2) continue;
    const role = JOB_ROLES[parts[parts.length - 1]!];
    if (role) return role;
  }
  return "none";
};

export const runFromGitHub = (raw: Record<string, any>): Run => ({
  id: Number(raw.id),
  event: String(raw.event ?? ""),
  title: String(raw.display_title ?? ""),
  headBranch: String(raw.head_branch ?? ""),
  status: String(raw.status ?? ""),
  conclusion: raw.conclusion ?? null,
  createdAt: String(raw.created_at ?? ""),
  updatedAt: String(raw.updated_at ?? raw.created_at ?? ""),
});

export const ticketFromGitHub = (raw: Record<string, any>): TicketState => ({
  number: Number(raw.number),
  title: String(raw.title ?? ""),
  labels: (raw.labels ?? []).map((l: { name: string }) => l.name),
  stateSince: undefined,
  marks: [],
});

const FACTORY_BODY = /Implemented by the software factory/;

/** From `gh pr list --json number,title,headRefName,headRefOid,labels,autoMergeRequest,body`. */
export const prFromGitHub = (raw: Record<string, any>): PrState => {
  const headRef = String(raw.headRefName ?? "");
  const body = String(raw.body ?? "");
  return {
    number: Number(raw.number),
    title: String(raw.title ?? ""),
    headRef,
    headSha: String(raw.headRefOid ?? ""),
    labels: (raw.labels ?? []).map((l: { name: string }) => l.name),
    autoMerge: raw.autoMergeRequest !== null && raw.autoMergeRequest !== undefined,
    factory: headRef.startsWith("agent/") || FACTORY_BODY.test(body),
    closes: [...issuesClosedByPrs([{ number: Number(raw.number), body }])][0],
    stateSince: undefined,
    marks: [],
  };
};

type TimelineEvent = { event: string; label?: { name: string }; body?: string; created_at?: string };

/** When `label` was last applied, from the issue or PR timeline; undefined when never. */
export const stateSinceFromTimeline = (events: readonly TimelineEvent[], label: string): string | undefined => {
  let since: string | undefined;
  for (const e of events) {
    if (e.event === "labeled" && e.label?.name === label && e.created_at) since = e.created_at;
  }
  return since;
};

export const marksFromTimeline = (events: readonly TimelineEvent[]): SweepMark[] => {
  const marks: SweepMark[] = [];
  for (const e of events) {
    if (e.event !== "commented" || !e.created_at) continue;
    const match = (e.body ?? "").match(SWEEP_MARK);
    if (match) marks.push({ miss: Number(match[1]), at: e.created_at });
  }
  return marks;
};
