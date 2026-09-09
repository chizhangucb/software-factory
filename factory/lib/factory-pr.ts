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

/** The factory opened this PR, or worked on it: an agent/ branch, its marker, or a verdict on it. */
export const isFactoryPr = (pr: FactoryPrFacts): boolean =>
  pr.headRef.startsWith(FACTORY_BRANCH_PREFIX) ||
  pr.body.includes(FACTORY_BODY_MARKER) ||
  pr.body.includes(VERDICT_SECTION_START);
