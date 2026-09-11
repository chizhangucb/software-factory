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
 *   second miss on the same stranding, or MAX_MISSES re-dispatches on it
 *   whatever the cause, escalates to needs-human. Escalation here leaves the
 *   same labels as the retry handler's (#50,
 *   `factory/retry/escalation.ts`): needs-human alone.
 * - PR in agent:review (or agent:implement, agent:in-progress) with no live
 *   review (implement-pr) run: same, with agent:review.
 * - factory PR with auto-merge not enabled: re-arm it (#83). The implement
 *   workflow's own step is non-fatal by design, so a refusal there left the
 *   PR unmergeable forever and the update-branch plan skipping it forever
 *   with "auto-merge not enabled".
 * - factory PR with auto-merge armed and no factory/verdict on its head:
 *   add agent:review.
 * - any other PR on main with no factory/verdict on its head, armed or not:
 *   add agent:review, unless it is a draft, from a fork, closes no ticket,
 *   or closes one an untrusted author opened (#182). This rule never arms
 *   it; once judged it is a factory PR, and the re-arm above reaches it.
 * - merge-ready PR behind main with no update-branch run in the window:
 *   dispatch factory-update-branch.
 * Every cancel is a lost event and counts as a miss (#149). The per-account
 * slots that cancelled a third run queued for a full one are gone, so there
 * is no longer a cancel the reconciler should forgive, and it no longer reads
 * a cause out of the job names.
 *
 * Both counts live in a marker comment on the subject, `<!-- factory:sweep
 * miss=<n> tries=<m> -->`, read back from the timeline: misses, and
 * re-dispatches whatever their cause. Each count is carried in the marker's
 * value rather than by counting markers, because a re-dispatch re-applies
 * the state label and every earlier marker then belongs to an earlier
 * stranding and stops counting. `tries` caps the loop at MAX_MISSES
 * re-dispatches on one stranding whatever their cause. Now that every miss is
 * counted the miss path reaches its own limit first; `tries` still ends a
 * stranding carrying markers the slot cap wrote, which recorded `miss=0`. A
 * marker written before `tries` existed reads its `miss` value as the try
 * count, floored at one: every marker is a re-dispatch.
 *
 * Imports use explicit `.ts` so the job can run on bare
 * `node --experimental-strip-types` without installing the engine.
 */
import { isFactoryPr } from "../lib/factory-pr.ts";
import { agentLabels, ESCALATION_LABEL, READY_LABEL } from "../lib/labels.ts";
import { issuesClosedBy } from "../lib/linked-issue.ts";
import { type Author, type TrustPolicy, authorAssociation } from "../lib/trusted-authors.ts";
import { escalationLabels } from "../retry/escalation.ts";

export type Deadlines = {
  /** A ticket or PR label with no live run for this long is stuck. */
  stuckMinutes: number;
  /** A PR head with no factory/verdict for this long is unjudged: an armed factory PR's, or any other PR's not left alone. */
  verdictMinutes: number;
  /** A merge-ready PR behind main with no update-branch run in this long needs one. */
  updateMinutes: number;
};

export const DEFAULT_DEADLINES: Deadlines = { stuckMinutes: 15, verdictMinutes: 30, updateMinutes: 30 };

export { ESCALATION_LABEL };
export const PARKED_LABELS = ["agent:blocked", ESCALATION_LABEL] as const;
export const UPDATE_BRANCH_EVENT = "factory-update-branch";
export const SWEEP_MARK = /^<!-- factory:sweep miss=(\d+)(?: tries=(\d+))? -->/;

/** Label timestamps and run timestamps are written by different actors; this much skew is noise. */
const SLACK_MS = 2 * 60_000;
/** Misses before escalating, and the cap on re-dispatches of any cause on one stranding. */
const MAX_MISSES = 2;

export type RunRole = "implement" | "review" | "implement-pr" | "dispatch" | "update-branch" | "merge-gate" | "audit" | "none";

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

export type SweepMark = {
  /** Lost events on this stranding so far. */
  miss: number;
  /** Re-dispatches on this stranding so far, whatever their cause. */
  tries: number;
  at: string;
};

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
  /** Opened by the factory, or worked on by it: `factory/lib/factory-pr.ts`. */
  factory: boolean;
  /** The ticket the body closes, when it names one. */
  closes: number | undefined;
  /** factory/verdict on the head; undefined when not read. */
  verdict?: VerdictState;
  /** Commits on main the head lacks; undefined when not read. */
  behindBy?: number;
  /** The later of the PR's creation and its head commit; undefined when not read. */
  headSince?: string;
  /** Marked draft: its author saying it is not ready. */
  draft: boolean;
  /** Its head is in another repository, which `agent-review.yml` refuses to run on. */
  fork: boolean;
  /** Whoever opened the ticket it closes, when that was read; only a PR that is not a factory PR needs it. */
  ticketAuthor?: Author;
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
  | { type: "dispatch"; eventType: typeof UPDATE_BRANCH_EVENT; pr: number }
  | { type: "arm-auto-merge"; pr: number };

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
  /** The ticket a PR closes: escalating the PR parks the ticket with it. */
  ticket?: number;
};

const markComment = (input: StuckInput, cause: string, miss: number, tries: number, deadline: number, url?: string): string => {
  const count = `Miss ${miss} of ${MAX_MISSES}: a second miss escalates to \`${ESCALATION_LABEL}\`.`;
  return [
    `<!-- factory:sweep miss=${miss} tries=${tries} -->`,
    `Reconciler: \`${input.state}\` since ${input.since ?? "an unknown time"}, ${cause} after the ${deadline} min deadline. Re-added \`${input.add}\`. ${count}`,
    url ? `\nSweep: ${url}` : "",
  ].join("\n");
};

const escalationComment = (input: StuckInput, remove: readonly string[], cause: string, gaveUp: string, deadline: number, url?: string): string => {
  const handBack =
    input.subject.kind === "issue"
      ? `remove \`${ESCALATION_LABEL}\`, then add \`${READY_LABEL}\` back and the dispatcher picks the ticket up on its next event, or add \`${input.add}\` by hand.`
      : `remove \`${ESCALATION_LABEL}\` here and on the ticket, add \`${READY_LABEL}\` back to the ticket, then add \`${input.add}\` to this PR.`;
  return [
    `## Escalated: \`${ESCALATION_LABEL}\``,
    "",
    `The reconciler gave up on this ${input.subject.kind === "issue" ? "ticket" : "PR"}: \`${input.state}\` since ${input.since ?? "an unknown time"}, ${cause} after the ${deadline} min deadline. ${gaveUp}`,
    "",
    `- Labels: ${remove.length > 0 ? `\`${remove.join("`, `")}\` removed, ` : ""}\`${ESCALATION_LABEL}\` added.`,
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
  if (latest === undefined) {
    cause = `no ${input.expected}`;
  } else if (latest.conclusion === "cancelled") {
    // Whatever cancelled it, the event that starts the run is gone: a miss like
    // any other. Nothing cancels a run for a reason to forgive any more (#149).
    cause = `run ${latest.id} cancelled`;
  } else {
    const endedAgo = minutesSince(now, latest.updatedAt);
    if (endedAgo < deadline) return none(`run ${latest.id} ended ${latest.conclusion} ${endedAgo} min ago, settling`);
    cause = `run ${latest.id} ended ${latest.conclusion} and left ${input.state}`;
  }

  const onThisStranding = input.marks.filter((m) => sinceMs === undefined || Date.parse(m.at) >= sinceMs - SLACK_MS);
  const previousMisses = onThisStranding.reduce((max, m) => Math.max(max, m.miss), 0);
  const previousTries = onThisStranding.reduce((max, m) => Math.max(max, m.tries), 0);
  // Two ways to give up, one budget. A second lost event is the old one, and
  // every miss counts now, so it is the one a fresh stranding reaches. The other
  // is the cap: MAX_MISSES re-dispatches on one stranding whatever their cause,
  // which still ends a stranding whose markers the slot cap wrote as miss=0.
  const lostTwice = previousMisses >= MAX_MISSES - 1;
  if (lostTwice || previousTries >= MAX_MISSES) {
    const escalation = escalationLabels(input.labels);
    const why = lostTwice ? "second miss" : `${previousTries} re-dispatches`;
    const gaveUp = lostTwice
      ? "The same after it was re-dispatched once. The event that starts the run was lost twice."
      : `The same after ${previousTries} re-dispatches, so re-dispatching is not getting it started.`;
    return {
      subject: input.subject,
      action: { type: "escalate", remove: escalation.remove, add: escalation.add, ticket: input.ticket },
      log: `${head}, ${cause}, ${why}: escalate to ${ESCALATION_LABEL}`,
      comment: escalationComment(input, escalation.remove, cause, gaveUp, deadline, snap.sweepUrl),
    };
  }
  const miss = previousMisses + 1;
  const tries = previousTries + 1;
  return {
    subject: input.subject,
    action: { type: "relabel", remove: agentLabels(input.labels), add: input.add, miss },
    log: `${head}, ${cause}: re-add ${input.add} (miss ${miss}, re-dispatch ${tries} of ${MAX_MISSES})`,
    comment: markComment(input, cause, miss, tries, deadline, snap.sweepUrl),
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

/** The age of a head and the log prefix that reports it; `undefined` age means unknown, which is overdue. */
const sinceHead = (p: PrState, what: string, now: number, deadline: number): { age: number | undefined; head: string } => {
  const age = p.headSince === undefined ? undefined : minutesSince(now, p.headSince);
  const since = p.headSince === undefined ? "unknown" : `${p.headSince}, ${age} min ago`;
  return { age, head: `#${p.number} (pr) ${what} since ${since}, deadline ${deadline} min` };
};

/**
 * Why the reconciler leaves a PR that is not a factory PR alone rather than
 * ask for its verdict (#182). `reason` is a fixed token, so a sweep log can be
 * grepped for `left alone (draft)`; `why` is the sentence beside it. Not
 * called a guard: CONTEXT.md keeps that word for a harness check under
 * `scripts/guards/`.
 */
export type LeftAlone = { reason: "draft" | "fork" | "no-ticket" | "untrusted-ticket-author"; why: string };

/**
 * The reasons `gh pr list` alone answers, in order. Exported because the sweep
 * asks it too: a PR one of these leaves alone needs no further read, so its
 * ticket's author and its head's verdict are read only past them, and the
 * sweep and the decision cannot disagree about which PRs those are.
 */
export const leftAloneFromListing = (p: PrState): LeftAlone | undefined => {
  if (p.draft) return { reason: "draft", why: "a draft is its author saying it is not ready" };
  if (p.fork) return { reason: "fork", why: "its head is in another repository, which agent-review.yml refuses with a comment" };
  if (p.closes === undefined) return { reason: "no-ticket", why: "its body closes no ticket, so there are no acceptance criteria to judge" };
  return undefined;
};

/**
 * The fourth reason, and #179's definition rather than a second one: the
 * target's own trust policy, asked on the `ticket-author` channel, which is
 * what `review-context.ts` asks before the reviewer, implement-pr or the
 * audit read a PR's linked ticket. A ticket it refuses reaches the reviewer
 * as no acceptance criteria, a mechanical fail, so labelling the PR only
 * makes noise, and then an escalation on a PR nobody asked to have judged.
 * An author the sweep could not read is not a trusted one: asked directly,
 * the policy would read a missing association as `NONE`, and a target that
 * listed `NONE` would then trust a ticket nobody looked at.
 */
const untrustedTicket = (ticket: number, author: Author | undefined, policy: TrustPolicy): LeftAlone | undefined => {
  if (author === undefined) return { reason: "untrusted-ticket-author", why: `#${ticket}'s author was not read` };
  if (policy.trusts("ticket-author", author)) return undefined;
  return {
    reason: "untrusted-ticket-author",
    why: `#${ticket} was opened by ${authorAssociation(author.association)}, and the trust policy acts on ${policy.associations.join(", ")}`,
  };
};

/** The first reason to leave a PR that is not a factory PR alone, or undefined when there is none. */
const whyLeftAlone = (p: PrState, policy: TrustPolicy): LeftAlone | undefined => {
  const listed = leftAloneFromListing(p);
  // `closes` is undefined only when the listing already said no-ticket; the test narrows it.
  if (listed || p.closes === undefined) return listed;
  return untrustedTicket(p.closes, p.ticketAuthor, policy);
};

/**
 * A PR that is not a factory PR, neither opened nor worked on by the factory,
 * with no agent on it (#182): ask for a verdict at the deadline, and nothing
 * else. ADR 0003's judged path made that verdict available to any producer
 * who labels `agent:review`; this is the reconciler applying the label for a
 * producer that did not, so it is the one route onto the judged path nobody
 * opted into. That is why it waited on #174, #180 and #183, each of which
 * stopped the factory writing destructively to a branch it did not author,
 * and why each reason to leave a PR alone is a case where labelling would do
 * something the PR's author never agreed to.
 *
 * Only the verdict: this decision never arms auto-merge (criterion 5). That
 * is not the end of it, though. The reviewer writes its verdict section into
 * the body, so from the next sweep on the PR is a factory PR and
 * `decidePrMerge` below owns it unchanged, re-arm included, which is ADR
 * 0003's "a judged PR the factory did not author becomes a factory PR".
 */
const decideUnjudged = (p: PrState, snap: Snapshot, deadlines: Deadlines, policy: TrustPolicy): Decision => {
  const subject: Subject = { kind: "pr", number: p.number };
  const none = (log: string): Decision => ({ subject, action: { type: "none" }, log });
  const leftAlone = whyLeftAlone(p, policy);
  if (leftAlone) return none(`#${p.number} (pr) not a factory PR, deadline ${deadlines.verdictMinutes} min: left alone (${leftAlone.reason}): ${leftAlone.why}`);
  const sha = p.headSha.slice(0, 7);
  if (p.verdict === undefined) return none(`#${p.number} (pr) not a factory PR, factory/verdict on ${sha} not read, deadline ${deadlines.verdictMinutes} min: skip`);
  if (p.verdict !== "none") return none(`#${p.number} (pr) not a factory PR, factory/verdict ${p.verdict} on ${sha}, deadline ${deadlines.verdictMinutes} min: judged or being judged`);
  const { age, head } = sinceHead(p, `not a factory PR, no factory/verdict on ${sha}`, Date.parse(snap.now), deadlines.verdictMinutes);
  if (age !== undefined && age < deadlines.verdictMinutes) return none(`${head}: within deadline`);
  return { subject, action: { type: "relabel", remove: [], add: "agent:review" }, log: `${head}: add agent:review` };
};

/**
 * PRs with no agent on them. Any other PR goes to `decideUnjudged` above; a
 * factory PR is unarmed, or judged, or stale behind main, or none of those.
 */
const decidePrMerge = (p: PrState, snap: Snapshot, deadlines: Deadlines, policy: TrustPolicy): Decision | undefined => {
  if (agentLabels(p.labels).length > 0 || PARKED_LABELS.some((l) => p.labels.includes(l))) return undefined;
  if (!p.factory) return decideUnjudged(p, snap, deadlines, policy);
  const subject: Subject = { kind: "pr", number: p.number };
  const none = (log: string): Decision => ({ subject, action: { type: "none" }, log });
  const sha = p.headSha.slice(0, 7);
  const now = Date.parse(snap.now);

  // Enabling auto-merge can fail on the implement run, where the step is non-fatal on
  // purpose (the PR exists and the preflight would refuse a retry, so the review must
  // still run). Nothing else ever retries it: the update-branch plan skips a PR with no
  // auto-merge with "auto-merge not enabled", so the PR could never merge. Re-arm it here
  // (#83). Safe at any point in the PR's life: the required factory/verdict holds the
  // merge until the reviewer passes it. The deadline keeps the sweep from racing the
  // implement run's own step, which arms it seconds after the PR is opened.
  if (!p.autoMerge) {
    const { age, head } = sinceHead(p, "factory PR with auto-merge not enabled", now, deadlines.stuckMinutes);
    if (age !== undefined && age < deadlines.stuckMinutes) return none(`${head}: within deadline`);
    return { subject, action: { type: "arm-auto-merge", pr: p.number }, log: `${head}: re-arm auto-merge` };
  }

  if (p.verdict === undefined) return none(`#${p.number} (pr) auto-merge armed, factory/verdict on ${sha} not read, deadline ${deadlines.verdictMinutes} min: skip`);
  if (p.verdict === "none") {
    const { age, head } = sinceHead(p, `auto-merge armed, no factory/verdict on ${sha}`, now, deadlines.verdictMinutes);
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
export const reconcile = (snap: Snapshot, deadlines: Deadlines, policy: TrustPolicy): Decision[] => {
  const decisions: Decision[] = [];
  for (const t of snap.issues) {
    const d = decideTicket(t, snap, deadlines);
    if (d) decisions.push(d);
  }
  for (const p of snap.prs) {
    const d = decidePrLabel(p, snap, deadlines) ?? decidePrMerge(p, snap, deadlines, policy);
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
  "merge-gate": "merge-gate",
  decide: "audit",
  audit: "audit",
};

/**
 * A reusable workflow's jobs are listed as `<caller job> / <called job>`; a
 * caller job whose `if` was false appears alone (and skipped), so only names
 * with a called part count.
 */
const calledJob = (name: string): string | undefined => {
  const parts = name.split(" / ");
  return parts.length < 2 ? undefined : parts[parts.length - 1];
};

/** A run's role from its job names. */
export const roleFromJobs = (jobs: readonly { name: string; conclusion: string | null }[]): RunRole => {
  for (const job of jobs) {
    const called = calledJob(job.name);
    const role = called === undefined ? undefined : JOB_ROLES[called];
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

/**
 * From `gh pr list --json number,title,headRefName,headRefOid,labels,autoMergeRequest,body,isDraft,isCrossRepository`.
 * A payload missing either of the last two reads as a draft and a fork: both
 * only ever leave alone a PR that is not a factory PR, so a field nobody asked for
 * leaves such a PR alone rather than labelling it on a fact never read.
 */
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
    factory: isFactoryPr({ headRef, body }),
    closes: issuesClosedBy(body)[0],
    draft: raw.isDraft !== false,
    fork: raw.isCrossRepository !== false,
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
    // A marker written before `tries` existed only ever counted misses, so its
    // miss value is the try count, floored at 1: every marker is a re-dispatch,
    // and the old code wrote `miss=0` for exactly the cancelled runs the cap is
    // for, which would otherwise back-fill as no re-dispatch at all.
    if (match) marks.push({ miss: Number(match[1]), tries: match[2] === undefined ? Math.max(Number(match[1]), 1) : Number(match[2]), at: e.created_at });
  }
  return marks;
};
