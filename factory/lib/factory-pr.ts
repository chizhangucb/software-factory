/**
 * One definition of a factory PR (#57 proposal 5), shared by the audit
 * (`factory/audit/plan.ts`) and the reconciler
 * (`factory/dispatch/reconcile.ts`). They each carried their own and the two
 * had already drifted: the audit tested `agent/issue-` and the body marker,
 * the reconciler tested `agent/` and the same marker as a regex. Neither
 * covered a PR a human opened that the factory then worked on through
 * implement-pr, so such a PR merged unaudited and uncounted.
 *
 * The branch test is the broader `agent/` prefix. `agent/` is the namespace
 * the factory owns (`agent-implement.yml` only ever cuts
 * `agent/issue-N-slug`), so the broad prefix loses nothing on a real factory
 * PR and gains anything else the factory ever puts there; and the two
 * failure directions are not symmetric. A false positive costs one extra
 * audit or one extra reconciler look. A false negative merges work
 * unaudited, which is the hole this module closes.
 *
 * The verdict section is what makes a human-opened PR visible. implement-pr
 * ends by adding `agent:review`, the reviewer runs, and `review.ts` writes
 * the section into the PR body with `upsertVerdictSection`. So the section
 * is the durable body-level record that the factory worked on this PR, on
 * the same field the audit's decide job already reads.
 *
 * Two questions, one module (#174). `isFactoryPr` is what the factory reads
 * and judges, and is deliberately broad: a human-opened PR the reviewer
 * judged has to reach the audit and the reconciler. `isFactoryAuthoredPr` is
 * what the factory may *do to* a branch, and drops the verdict arm, because
 * that arm is exactly the human-opened PR. Escalation used to close whatever
 * PR was open, so labelling a hand-authored PR `agent:review`, the one action
 * that gets it judged, destroyed it. They live together because the broad one
 * is written as the narrow one plus the verdict section: two predicates that
 * could disagree in principle cannot disagree here.
 *
 * The body is the signal on purpose, and a human who edits the section out
 * does hide the PR from the audit. The two alternatives cost a mechanism
 * this spec does not add: the `factory/verdict` status needs GITHUB_TOKEN,
 * which the decide job does not hold (it runs on FACTORY_PAT, and a
 * fine-grained PAT cannot read statuses), and the `agent:*` timeline needs a
 * second read of labels that both agent workflows take back off on the way
 * out. Revisit if a body edit is ever seen in the wild.
 *
 * Imports nothing, so a job can run it on bare
 * `node --experimental-strip-types` with no install. Every sparse-checkout
 * cone that reaches it lists it.
 */

/** Branch namespace the factory owns; `agent-implement.yml` cuts `agent/issue-N-slug` inside it. */
export const FACTORY_BRANCH_PREFIX = "agent/";

/** The line `agent-implement.yml` writes into the body of every PR it opens. */
export const FACTORY_BODY_MARKER = "Implemented by the software factory";

/** Opens the verdict section the reviewer upserts into the PR body (`factory/lib/verdict.ts`). */
export const VERDICT_SECTION_START = "<!-- factory:verdict -->";

/** What the audit and the reconciler need to know about a PR to place it. */
export interface FactoryPrFacts {
  readonly headRef: string;
  readonly body: string;
}

/**
 * The factory itself opened this PR: an `agent/` branch, or the marker
 * `agent-implement.yml` writes into every body it opens with. Both are
 * things only the factory writes, and neither is a label, so nothing a human
 * adds or removes from a PR can turn this answer either way (#174). A human
 * *can* cut an `agent/` branch by hand, which is the safe direction to be
 * wrong in: the namespace is the factory's, and the arms are read only to
 * decide what may be *done to* a branch, where a false positive is at worst
 * the factory closing a PR someone deliberately filed inside its namespace.
 *
 * The narrow half of the definition. Use it for what the factory may do to a
 * PR, `isFactoryPr` for what it reads and judges.
 */
export const isFactoryAuthoredPr = (pr: FactoryPrFacts): boolean =>
  pr.headRef.startsWith(FACTORY_BRANCH_PREFIX) || pr.body.includes(FACTORY_BODY_MARKER);

/**
 * The factory opened this PR, or worked on it: an agent/ branch, its marker,
 * or a verdict on it. Written as the authored test plus the verdict section
 * rather than as three arms of its own, so the broad answer is the narrow one
 * by construction and the pair cannot drift the way the audit and the
 * reconciler had already drifted.
 */
export const isFactoryPr = (pr: FactoryPrFacts): boolean =>
  isFactoryAuthoredPr(pr) || pr.body.includes(VERDICT_SECTION_START);
