/**
 * The factory's own address, and the one place that says it (#116).
 *
 * Every target's caller checks the factory out by name before it can run a
 * single step: `factory_repo` is a `workflow_call` input on all seven reusable
 * workflows, and `dispatch.yml` hands it to `actions/checkout` as
 * `repository:`. A caller pins `@main`, so a default naming a repo that does
 * not exist under that name is not a stale string, it is every factory job on
 * every target failing at checkout at once.
 *
 * **This is a test's constant, not a single source of truth.** Nothing imports
 * it but `factory-repo.test.ts`, and it cannot be otherwise: the copies that
 * matter are YAML, and a workflow cannot import a TypeScript constant. The
 * address is still written in every one of those places. What this buys is
 * that each of them is checked against this one on every run. Same arrangement
 * as `heartbeat/interval.ts`, and the same reason.
 *
 * The repo was `chizhangucb/software-factory` until 2026-09-12 and is
 * `chizhangucb/tomte` now. The rename touched seven `factory_repo` defaults,
 * one per reusable workflow, and the caller template here, and seven `uses:`
 * lines in each of three callers that live in other repos. A name in that many
 * places is one that drifts, which is the lesson #261 wrote down for the
 * heartbeat's interval.
 *
 * **What this does not cover.** A caller lives in the target repo, outside this
 * repo's reach, so `factory-repo.test.ts` holds only this repo's own copies to
 * the constant. The callers are checked by onboarding and by the fixture run,
 * and GitHub's rename redirect is what covers a caller nobody has updated yet.
 * The redirect is a grace period and not a fix: a caller still naming the old
 * repo works until someone takes that name.
 *
 * Builtins only, the way `heartbeat/targets.ts` is, so importing it from the
 * sender's cone would never cost that cone its bare
 * `node --experimental-strip-types` run.
 */

/** `chizhangucb/tomte`. The repo holding the factory's scripts and workflows. */
export const FACTORY_REPO = "chizhangucb/tomte";

/**
 * The name this repo went by until 2026-09-12, kept so the test can hunt for
 * it. GitHub redirects the old name, so nothing breaks loudly when a copy is
 * missed; that silence is exactly why a test has to do the looking.
 */
export const FORMER_FACTORY_REPO = "chizhangucb/software-factory";
