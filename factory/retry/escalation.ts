/**
 * What the factory does to a subject it is standing down or handing on: the
 * labels escalation leaves behind (#50), what escalation does to the open PR
 * (#174), and who the retry hands the open PR to (#183). Pure, a fact about
 * the subject in and the actions out, so the callers cannot park a ticket two
 * ways, and so that "the factory may act on this branch" is answered once.
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
import { agentLabels, ESCALATION_LABEL, IMPLEMENT_LABEL, isAgentLabel, READY_LABEL } from "../lib/labels.ts";

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

/**
 * What a decision about the open PR needs to know: enough to place it, plus
 * the labels it carries. One shape, because escalating a PR and handing one
 * back to its author ask the same two questions of it.
 */
export interface LabelledPrFacts extends FactoryPrFacts {
  readonly labels: readonly string[];
}

/**
 * Standing a PR down: every `agent:*` label off and `needs-human` on. One
 * definition, because bare removal is not a stand-down and the two callers
 * would otherwise each have to remember that. The reconciler reads a
 * **Factory PR** with no `agent:*` label as one to arm and judge, so removal
 * alone holds only until the next heartbeat repairs it; `needs-human` is what
 * `PARKED_LABELS` parks on, and parking is what makes it stick.
 */
const standDown = (labels: readonly string[]): { readonly remove: string[]; readonly add: typeof ESCALATION_LABEL } => ({
  remove: agentLabels(labels),
  add: ESCALATION_LABEL,
});

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
export const prEscalation = (pr: LabelledPrFacts): PrEscalation => {
  const close = isFactoryAuthoredPr(pr);
  const down = standDown(pr.labels);
  return {
    remove: down.remove,
    // A closed PR is in no listing the reconciler reads, so it needs no parking label.
    add: close ? undefined : down.add,
    close,
  };
};

/**
 * Who fixes a failure on the open PR (#183): the factory's implementer, on a
 * branch the factory authored, or the PR's own author on anyone else's.
 */
export type Fixer = "factory" | "author";

/**
 * What the retry handler does to the open PR: who fixes it, and the labels
 * that say so. `add` is one of two labels and not any string, so "no
 * `agent:implement` on a branch the factory did not author" is a fact tsc
 * checks rather than one a caller has to keep.
 */
export interface PrFix {
  readonly fixer: Fixer;
  readonly remove: string[];
  readonly add: typeof IMPLEMENT_LABEL | typeof ESCALATION_LABEL;
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
 * So the fix goes back to whoever owns the branch, and the labels say which:
 *
 * - the factory's branch: `agent:implement`, exactly as before, nothing
 *   removed. The implementer runs again with the failing output in its prompt.
 * - anyone else's: no `agent:implement`, `agent:*` off and `needs-human` on.
 *   Declining to label is not on its own a decline: a PR left with no
 *   `agent:*` label is one the reconciler arms, judges and re-labels at its
 *   verdict deadline, so the next heartbeat would hand the branch to an
 *   implementer anyway and the decline would have to be made again every
 *   heartbeat. `needs-human` parks it, which is what makes the decline hold,
 *   and it is true: the author is the human this now needs.
 *
 * `isFactoryAuthoredPr` and not `isFactoryPr`, for the reason #174 gives: the
 * broad predicate's verdict arm is exactly the PR the factory did not author,
 * which is the one this must not put an implementer on. Reused rather than
 * re-tested here, so this answer and escalation's cannot drift.
 */
export const prFix = (pr: LabelledPrFacts): PrFix =>
  isFactoryAuthoredPr(pr)
    ? { fixer: "factory", remove: [], add: IMPLEMENT_LABEL }
    : { fixer: "author", ...standDown(pr.labels) };
