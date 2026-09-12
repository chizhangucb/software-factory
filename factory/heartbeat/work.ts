/**
 * Whether a target has anything waiting, so the heartbeat can skip a target a
 * sweep would find nothing to do on (#212). Waking one costs a billed Actions
 * minute whatever the sweep decides; asking costs API calls, which are free.
 *
 * One subject is waiting when a sweep would act on it:
 * - a ticket a human marked ready that nothing holds, which the dispatcher
 *   would dispatch,
 * - a ticket in a factory state label, which the reconciler would repair,
 * - any open pull request, whoever produced it, because the reconciler asks for
 *   a verdict on an unjudged one and updates a judged one that has fallen
 *   behind.
 * Never a parked subject, and never a held ticket: nothing sweeps either until a
 * human acts. A held pull request is still work, since a hold withholds the
 * reviewer and never the merge path (#210).
 *
 * That much says a sweep could act on the subject. Whether it would act *now*
 * is the second question (#264), and it is the one that decides the bill: a
 * subject open and waiting on a human is work by every rule above and woke its
 * target every pass for as long as it sat there. Every repair the reconciler
 * makes is gated on one of its deadlines, so a subject is due when one of
 * those deadlines has just fallen, when it has just changed, or when no
 * deadline is running on it at all. `due` below is that rule and carries the
 * reasoning.
 *
 * Every label set is imported from the module that owns it, so a change to any
 * of them reaches the heartbeat with it, and the deadlines travel the same
 * route. Nothing here spells a label or restates a deadline (`work.test.ts`
 * pins both).
 *
 * Builtins only and explicit `.ts`, so `send.ts` reaches it on bare
 * `node --experimental-strip-types`.
 */
import { PROJECTIONS } from "../dispatch/gh-read.ts";
import { DEFAULT_DEADLINES, PARKED_LABELS } from "../dispatch/reconcile.ts";
import { FACTORY_STATE_LABELS } from "../dispatch/select.ts";
import { HOLD_LABELS, READY_LABEL } from "../lib/labels.ts";
import { HEARTBEAT_INTERVAL_MINUTES } from "./interval.ts";

/** One open ticket or pull request, reduced to what the rules read. */
export type OpenSubject = {
  /** The open-issues endpoint lists pull requests too; this is which one it is. */
  readonly pullRequest: boolean;
  readonly labels: readonly string[];
  /**
   * When the subject last changed, GitHub's `updated_at`; undefined when it was
   * not read, which counts as due, the way the reconciler counts a state whose
   * age it does not know as overdue.
   */
  readonly changedAt?: string;
};

/**
 * The one read the heartbeat makes per target: the sweep's own open-issues
 * call, which lists pull requests alongside tickets and whose projection
 * already carries the flag telling them apart and the timestamp `due` reads, so
 * one paginated read answers every rule below. Paginated and projected for the
 * reason `gh-read.ts` gives: a target with many issues would otherwise blow the
 * process buffers. A GET with no `--method`, so asking a target what is open
 * cannot itself start a job on it.
 */
export const openWorkArgs = (target: string): string[] => [
  "api",
  "--paginate",
  `repos/${target}/issues?state=open&per_page=100`,
  "--jq",
  PROJECTIONS.issues,
];

/**
 * `PROJECTIONS.issues` output, one item per line, reduced to the subjects. The
 * flag is read for truth rather than against `true`, as `sweep.ts` reads it:
 * the projection prints a boolean, GitHub's own JSON puts an object there, and
 * a reader that took the object for a ticket would skip a target whose only
 * work is a pull request.
 */
export const fromGitHub = (raw: readonly unknown[]): OpenSubject[] =>
  raw.map((item) => {
    const r = item as Record<string, any>;
    return {
      pullRequest: Boolean(r.pull_request),
      labels: (r.labels ?? []).map((label: { name: string }) => label.name),
      changedAt: typeof r.updated_at === "string" ? r.updated_at : undefined,
    };
  });

/**
 * The deadlines a sweep judges this kind of subject by, taken from the
 * reconciler's own defaults rather than restated: `decideTicket` judges a
 * ticket by `stuckMinutes` alone, while a pull request is judged by every one
 * of them (the label states and the auto-merge re-arm by `stuckMinutes`, the
 * verdict by `verdictMinutes`, the update by `updateMinutes`). A deadline added
 * to the set reaches a pull request here with no edit, and fails
 * `interval.test.ts` until a human has looked at it.
 *
 * A target may override any of the three in its own caller and the factory
 * cannot read a target's caller, so these are the deadlines the heartbeat
 * reasons from whatever a target actually runs. The direction that leaves is
 * deliberate: an override upward or downward moves the sweep that repairs the
 * subject and not this rule, so the wake can be a pass early (a wasted minute)
 * or a pass late (a repair that waits for the target's own `schedule`, the
 * fallback CONTEXT.md already names). Waking on the factory's own defaults is
 * the safe direction and still beats waking always, which is what #264
 * replaces.
 */
const deadlinesFor = (pullRequest: boolean): number[] => [
  ...new Set(pullRequest ? Object.values(DEFAULT_DEADLINES) : [DEFAULT_DEADLINES.stuckMinutes]),
];

/**
 * Would a sweep act on this subject *now*?
 *
 * A deadline is only ever checked when a sweep runs, so the pass that matters
 * is the first one after it falls: the sweep repairs the subject then, and
 * every repair changes the subject, which starts the next deadline. So the
 * question is whether the last interval contains a deadline or a change, and
 * not whether the subject is past one, which is true forever and is what woke
 * a target every pass.
 *
 * - Never read: due, the way the reconciler treats a state whose age it does
 *   not know as overdue.
 * - A ticket a human marked ready that the factory has not picked up: due
 *   whatever its age. The dispatcher has no deadline, so it dispatches on the
 *   sweep that sees the ticket, and nothing new waits on a clock that never
 *   started.
 * - Changed since the last pass: due. The change may be the one thing a sweep
 *   was waiting for, a hold taken off a ticket the reconciler still holds
 *   being the case CONTEXT.md promises resumes on the first sweep, and every
 *   deadline runs from it.
 * - One of its deadlines fell during the last interval: due. That is the pass
 *   the repair belongs to.
 *
 * It reasons from `updated_at`, which is the only clock in the one read the
 * heartbeat makes. The reconciler's own clocks run from a label event or a
 * head commit, both of which are changes to the subject and so are at or
 * before this one, and both of which the sweep's own reads answer exactly.
 * A pass the host never ran is a window nobody looked at: the caller's
 * `schedule` is the fallback for that, as it is for a heartbeat that is not
 * running at all.
 */
const due = (subject: OpenSubject, now: Date): boolean => {
  if (subject.changedAt === undefined) return true;
  if (!subject.pullRequest && subject.labels.includes(READY_LABEL) && !FACTORY_STATE_LABELS.some((label) => subject.labels.includes(label))) return true;
  const age = (now.getTime() - Date.parse(subject.changedAt)) / 60_000;
  if (age < HEARTBEAT_INTERVAL_MINUTES) return true;
  return deadlinesFor(subject.pullRequest).some((deadline) => age >= deadline && age < deadline + HEARTBEAT_INTERVAL_MINUTES);
};

/** Would a sweep act on this subject at all, at any deadline? */
const waiting = ({ pullRequest, labels }: OpenSubject): boolean => {
  const has = (label: string) => labels.includes(label);
  if (PARKED_LABELS.some(has)) return false;
  // Before the hold, because a hold withholds the reviewer and never the merge
  // path (#210): the reconciler still re-arms auto-merge on a held PR and still
  // brings it up to date, so a held PR is work.
  if (pullRequest) return true;
  // A held ticket is not, whatever state label it carries: the dispatcher skips
  // it as held and the reconciler leaves it alone rather than re-stamping it.
  if (HOLD_LABELS.some(has)) return false;
  if (has(READY_LABEL)) return true;
  return FACTORY_STATE_LABELS.some(has);
};

/**
 * What one target's open subjects mean for this pass. Three answers and not
 * two, because the two that do not wake the target are different facts about it
 * and a maintainer reads the pass to tell them apart (#264):
 * - `waiting`: a sweep would act on something now, so the target is woken.
 * - `nothing-due`: work is open and every subject of it is between deadlines.
 *   The deadline it crosses next is the pass that reaches it.
 * - `nothing-waiting`: nothing open that any sweep would act on at any
 *   deadline, whether the target is empty or everything on it is parked or held
 *   until a human acts.
 *
 * One call rather than a predicate per answer, so no caller can ask the three
 * questions in an order that contradicts itself.
 */
export type SweepNeed = "waiting" | "nothing-due" | "nothing-waiting";

export const sweepNeed = (open: readonly OpenSubject[], now: Date): SweepNeed => {
  const couldAct = open.filter(waiting);
  if (couldAct.length === 0) return "nothing-waiting";
  return couldAct.some((subject) => due(subject, now)) ? "waiting" : "nothing-due";
};
