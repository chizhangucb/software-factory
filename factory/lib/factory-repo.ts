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
 * That is why this is a constant with a test on it rather than prose. The repo
 * was `chizhangucb/software-factory` until 2026-09-12 and is `chizhangucb/tomte`
 * now, and the rename had to touch eight defaults in this repo and seven
 * `uses:` lines in each of three callers. A name in that many places is one
 * that drifts, which is the lesson #261 wrote down for the heartbeat's
 * interval and this is the same shape.
 *
 * **What this does not cover.** A caller lives in the target repo, outside this
 * repo's reach, so `factory-repo.test.ts` holds only this repo's own copies to
 * the constant. The callers are checked by onboarding and by the fixture run,
 * and GitHub's rename redirect is what covers a caller nobody has updated yet.
 * The redirect is a grace period and not a fix: a caller still naming the old
 * repo works until someone takes that name.
 *
 * Builtins only, so it stays reachable from the sender's cone the way
 * `heartbeat/targets.ts` does.
 */

/** `chizhangucb/tomte`. The repo holding the factory's scripts and workflows. */
export const FACTORY_REPO = "chizhangucb/tomte";

/**
 * The name this repo went by until 2026-09-12, kept so the test can hunt for
 * it. GitHub redirects the old name, so nothing breaks loudly when a copy is
 * missed; that silence is exactly why a test has to do the looking.
 */
export const FORMER_FACTORY_REPO = "chizhangucb/software-factory";
