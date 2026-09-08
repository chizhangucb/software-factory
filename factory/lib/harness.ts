/**
 * What the harness running an agent already provides, as opposed to the
 * skills the factory vendors and installs itself (`plugins.ts`).
 *
 * sandcastle names every agent provider it builds (`claude-code`, `codex`,
 * `cursor`, `opencode`, `copilot`, `pi`). The factory runs Claude Code, whose
 * CLI ships a `code-review` skill of its own; ADR 0001 lets another vendor's
 * subscription take its place. So the implementer prompt reads its
 * bundled-review step off the provider the run drew, rather than off a
 * constant someone must remember to change: swap the provider and the step
 * goes with it (story 12 of #46).
 */

/** Harnesses whose CLI ships a `code-review` skill, by sandcastle's provider name. */
const HARNESSES_WITH_BUNDLED_CODE_REVIEW: readonly string[] = ["claude-code"];

/**
 * The implementer prompt's second review step, empty on a harness with no
 * code review of its own. Step 2 because Matt's two-axis review is always
 * step 1, and empty is a clean skip: that review is then the whole of the
 * prompt's review stage.
 */
export const bundledReviewStep = (harness: string): string =>
  HARNESSES_WITH_BUNDLED_CODE_REVIEW.includes(harness)
    ? "2. Invoke the bundled skill `code-review` with args `medium --fix`, so it reviews this branch's changes since `main` and applies its findings to the working tree. Check what it changed and keep the tests green.\n"
    : "";
