/**
 * The ticket a PR body says it closes, by the keywords GitHub honours
 * (`Closes #N`, `Fixed: #N`, ...). One regex for the reviewer, the gate, the
 * retry handler and the dispatcher's selection, so they all agree on which
 * ticket a PR belongs to.
 *
 * The pattern stays private and callers read the decision instead:
 * `linkedIssueNumber` for the one ticket a PR belongs to, `issuesClosedBy`
 * for every ticket a body claims, which is what the dispatcher needs to know
 * an open PR already covers a ticket.
 *
 * Imports use explicit `.ts` and this module imports nothing, so the dispatch
 * job can run it on bare `node --experimental-strip-types` without
 * installing the engine.
 */

/**
 * Global, so both readers below take every match rather than the first. Read
 * only through `matchAll`, which matches against a copy: `exec` and `test`
 * would carry `lastIndex` from one call into the next.
 */
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

/** The digits of every closing reference in a body, in the order they appear. */
const closingReferences = (prBody: string | null | undefined): string[] =>
  [...(prBody ?? "").matchAll(CLOSES)].map((match) => match[1]!);

/** The ticket a PR belongs to: the first it claims to close, or "" for none. */
export const linkedIssueNumber = (prBody: string | null | undefined): string =>
  closingReferences(prBody)[0] ?? "";

/** Every ticket a body claims to close. */
export const issuesClosedBy = (prBody: string | null | undefined): number[] =>
  closingReferences(prBody).map(Number);
