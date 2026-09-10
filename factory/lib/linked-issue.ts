/**
 * The ticket a PR body says it closes, by the keywords GitHub honours
 * (`Closes #N`, `Fixed: #N`, ...). One regex for every reader that has to
 * agree on which ticket a PR belongs to: the reviewer's context, the gate,
 * the implement workflow's preflight, the retry handler, and the dispatcher's
 * selection and reconciler.
 *
 * The pattern stays private and callers read the decision instead:
 * `linkedIssueNumber` for the one ticket a PR belongs to, `issuesClosedBy`
 * for every ticket a body claims, which is what the dispatcher needs to know
 * an open PR already covers a ticket.
 *
 * This module imports nothing, and callers may import it with or without the
 * `.ts` extension, so the strip-types jobs (dispatch) and the tsx jobs (gate,
 * retry, review) both get it.
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
