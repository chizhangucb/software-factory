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
 * Never a parked subject: nothing sweeps one until a human acts.
 *
 * Every label set is imported from the module that owns it, so a change to any
 * of them reaches the heartbeat with it. Nothing here spells a label
 * (`work.test.ts` pins that).
 *
 * Builtins only and explicit `.ts`, so `send.ts` reaches it on bare
 * `node --experimental-strip-types`.
 */
import { PROJECTIONS } from "../dispatch/gh-read.ts";
import { PARKED_LABELS } from "../dispatch/reconcile.ts";
import { FACTORY_STATE_LABELS } from "../dispatch/select.ts";
import { HOLD_LABELS, READY_LABEL } from "../lib/labels.ts";

/** One open ticket or pull request, reduced to what the rules read. */
export type OpenSubject = {
  /** The open-issues endpoint lists pull requests too; this is which one it is. */
  readonly pullRequest: boolean;
  readonly labels: readonly string[];
};

/**
 * The one read the heartbeat makes per target: the sweep's own open-issues
 * call, which lists pull requests alongside tickets and whose projection
 * already carries the flag telling them apart, so one paginated read answers
 * every rule below. Paginated and projected for the reason `gh-read.ts` gives:
 * a target with many issues would otherwise blow the process buffers. A GET
 * with no `--method`, so asking a target what is open cannot itself start a job
 * on it.
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
    return { pullRequest: Boolean(r.pull_request), labels: (r.labels ?? []).map((label: { name: string }) => label.name) };
  });

/** Would a sweep act on this subject? */
const waiting = ({ pullRequest, labels }: OpenSubject): boolean => {
  const has = (label: string) => labels.includes(label);
  if (PARKED_LABELS.some(has)) return false;
  if (pullRequest) return true;
  if (has(READY_LABEL) && !HOLD_LABELS.some(has)) return true;
  return FACTORY_STATE_LABELS.some(has);
};

/** Does anything open on this target need a sweep? */
export const needsSweep = (open: readonly OpenSubject[]): boolean => open.some(waiting);
