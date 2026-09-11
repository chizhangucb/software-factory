/**
 * What the factory does to a subject it is parking or handing on: the labels
 * escalation leaves behind (#50), what escalation does to the open PR (#174),
 * and whether the retry may put an implementer on that PR's branch (#183).
 * Pure, a fact about the subject in and the actions out, so the callers cannot
 * park a ticket two ways, and so that "the factory may write to this branch"
 * is answered once.
 *
 * Two paths escalate. The retry handler does it when the retry fails too,
 * and the reconciler (#35) does it when the event that starts a run is lost
 * twice, or when re-dispatching has hit its cap without the run ever
 * getting started. A human reading a parked ticket cannot tell which one did
 * it, so both ask here and a parked ticket looks the same either way.
 *
 * Imports use explicit `.ts` so the dispatch job can run this on bare `node
 * --experimental-strip-types` without installing the engine.
 */
import { type FactoryPrFacts, isFactoryAuthoredPr } from "../lib/factory-pr.ts";
import { agentLabels, BLOCKED_LABEL, ESCALATION_LABEL, IMPLEMENT_LABEL, isAgentLabel, READY_LABEL } from "../lib/labels.ts";

/**
 * Escalating: `needs-human` on, every `agent:*` label off, and
 * `ready-for-agent` off with them. The dispatcher refuses a ticket carrying
 * `needs-human`, so one that also still said "ready" said two things at
 * once. An escalated ticket shows one label and a human re-adds
 * `ready-for-agent` to rerun it.
 *
 * Only labels the subject carries are named, so no caller asks GitHub to
 * remove a label that is not there, and a PR, which never carries
 * `ready-for-agent`, loses only its `agent:*` ones.
 */
export const escalationLabels = (
  labels: readonly string[],
): { readonly remove: string[]; readonly add: typeof ESCALATION_LABEL } => ({
  remove: labels.filter((label) => isAgentLabel(label) || label === READY_LABEL),
  add: ESCALATION_LABEL,
});

/** What escalation needs to know about the open PR: enough to place it, plus its labels. */
export interface EscalatedPrFacts extends FactoryPrFacts {
  readonly labels: readonly string[];
}

/** What escalation does to the open PR: which labels come off, which goes on, and whether it closes. */
export interface PrEscalation {
  readonly remove: string[];
  /** The parking label a PR left open needs, `undefined` when it closes. */
  readonly add: string | undefined;
  readonly close: boolean;
}

/**
 * What escalation does to the open PR (#174).
 *
 * Every `agent:*` label comes off either way. A PR escalation is done with is
 * a PR no factory run may pick up again, and that is true whether it closes or
 * stays open; a closed PR carries no state besides. Closing says nothing about
 * the ticket, which keeps its own labels until the escalation decides them.
 *
 * A PR left open needs `needs-human` on it as well, and not only the removals.
 * Bare removal stands it down for exactly as long as nothing repairs it: the
 * reconciler reads any **Factory PR** with no `agent:*` label as one to arm
 * and judge, and re-adds `agent:review` at its verdict deadline, which is the
 * very step that escalated this PR in the first place. `needs-human` is what
 * the reconciler parks on, so the label that records the escalation is also
 * the one that makes "no factory run picks it up again" true. Closing already
 * takes the PR out of every listing the reconciler reads, so it needs none.
 *
 * Closing is right only for a PR the factory opened: the attempt failed, the
 * ticket still holds the work, and a later run cuts a fresh branch from main
 * and opens a new PR from it. Applied to a PR a person or an outside agent
 * wrote, the same step throws away work nothing can recreate, and the path is
 * reachable without anyone intending it. A PR the factory did not author
 * closes no ticket, so the reviewer has no acceptance criteria to tick and
 * posts `factory/verdict` as a failure; `unretryableReason` rightly calls that
 * unfixable by any implementer run, `decide` turns unretryable into an
 * escalation, and escalation closed the PR. Labelling such a PR `agent:review`,
 * the one action that gets it judged, destroyed it.
 *
 * `isFactoryAuthoredPr` and not `isFactoryPr`: the broad one answers what the
 * factory reads and judges, and its verdict arm is *exactly* the PR the factory
 * did not author that must survive this. Not a label either, per #174: the
 * branch prefix and the body marker are written by the factory when it opens
 * the PR and are not the sort of thing a human adds or removes on one.
 */
export const prEscalation = (pr: EscalatedPrFacts): PrEscalation => {
  const close = isFactoryAuthoredPr(pr);
  return {
    remove: agentLabels(pr.labels),
    add: close ? undefined : ESCALATION_LABEL,
    close,
  };
};

/**
 * What the factory does with a failure on the open PR: hand the branch to its
 * own implementer, or tell the PR's author. `planConflict` in
 * `factory/update-branch/plan.ts` names the same two things the same way
 * (#180), and CONTEXT.md defines both, so the retry handler's answer reads as
 * the one the rest of the factory already gives.
 */
export type PrFixAction = "hand-off" | "tell-author";

/**
 * What the retry handler does to the open PR: which of the two, and the label
 * that says so. `add` is one of two labels and not any string, so "no
 * `agent:implement` on a branch the factory did not author" is a fact tsc
 * checks rather than one a caller has to keep.
 */
export interface PrFix {
  readonly action: PrFixAction;
  readonly add: typeof IMPLEMENT_LABEL | typeof BLOCKED_LABEL;
}

/**
 * What the retry handler does to the open PR when something has to fix it
 * (#183): the retry after a failing check, and the conflict hand-off, which
 * take the same answer from here rather than each asking their own.
 *
 * `agent:implement` is not a record of anything. It is the label that starts
 * `agent-implement-pr.yml`, which checks the branch out, lets an agent commit
 * on it and pushes. That is the whole point on a PR the factory opened, where
 * the branch is the factory's own; on a PR a person or an outside agent wrote
 * it is an agent rewriting their branch, the hazard #174 named for escalation
 * and #180 for the update-branch plan.
 *
 * The path is the common one rather than the rare one, which is why it is
 * worth narrowing. A judged PR whose verdict fails for a real reason (the
 * acceptance criteria are there and not all ticked) never reaches
 * `unretryableReason`: `decide` answers `retry`, and the retry labelled
 * whatever PR was open.
 *
 * So the fix goes to whoever owns the branch, and one label says which:
 *
 * - the factory's branch: a **hand-off**, `agent:implement`, exactly as
 *   before. The implementer runs again with the failing output in its prompt.
 * - anyone else's: a **tell-author**, `agent:blocked`, which is the same
 *   answer `planConflict` gives the same PR (#180) and is deliberately not a
 *   second one. Declining to label is not on its own a decline: a PR left with
 *   no `agent:*` label is one the reconciler arms, judges and re-labels at its
 *   verdict deadline, so the next heartbeat would hand the branch to an
 *   implementer anyway. `agent:blocked` is in `PARKED_LABELS`, so nothing
 *   re-arms it, and in `HANDED_OFF_LABELS`, so update-branch skips it instead
 *   of telling its author again on every push to main. The author taking the
 *   label off is what hands the PR back.
 *
 * Nothing is taken off either way. `agent:blocked` is a note and not a
 * transition (ADR 0005), so it strips no state; the agent workflows drop
 * `agent:in-progress` on their own way out, and `needs-human` is the other
 * thing entirely, the factory giving up rather than waiting on a person.
 *
 * `isFactoryAuthoredPr` and not `isFactoryPr`, for the reason #174 gives: the
 * broad predicate's verdict arm is exactly the PR the factory did not author,
 * which is the one this must not put an implementer on. Reused rather than
 * re-tested here, so this answer, escalation's and update-branch's cannot
 * drift.
 */
export const prFix = (pr: FactoryPrFacts): PrFix =>
  isFactoryAuthoredPr(pr)
    ? { action: "hand-off", add: IMPLEMENT_LABEL }
    : { action: "tell-author", add: BLOCKED_LABEL };
