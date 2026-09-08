/**
 * What the harness running an agent already provides, as opposed to the
 * skills the factory vendors and installs itself (`plugins.ts`).
 *
 * The factory runs Claude Code today: `claudeAgent` in the vendored
 * `agent-workflows/shared/common.ts` builds `sandcastle.claudeCode`, and the
 * Claude Code CLI ships a `code-review` skill of its own. ADR 0001 lets
 * another vendor's subscription take its place and sandcastle's library
 * already carries Codex, Cursor and the rest, so the implementer prompt has
 * to read correctly on a harness that bundles no code review: this module
 * renders that step, and returns nothing at all when the harness has none
 * (story 12 of #46).
 */

/** The harness the factory runs its agents on. */
export const FACTORY_HARNESS = "claude-code";

/** Harnesses whose CLI ships a `code-review` skill. */
const HARNESSES_WITH_BUNDLED_CODE_REVIEW: readonly string[] = ["claude-code"];

/**
 * The implementer prompt's bundled-review step, empty on a harness that has
 * no code review of its own. Empty is a clean skip: the step vanishes and
 * Matt's review, which is vendored and always present, is the whole of the
 * prompt's review stage.
 */
export const bundledReviewStep = (harness: string): string =>
  HARNESSES_WITH_BUNDLED_CODE_REVIEW.includes(harness)
    ? "2. Invoke the bundled skill `code-review` with args `medium --fix`, so it reviews this branch's changes since `main` and applies its findings to the working tree. Check what it changed and keep the tests green.\n"
    : "";
