/**
 * The ticket a PR body says it closes, by the keywords GitHub honours
 * (`Closes #N`, `Fixed: #N`, ...). One regex for the reviewer, the gate, and
 * the retry handler so they all agree on which ticket a PR belongs to.
 * `dispatch/select.ts` keeps its own copy: the dispatch job checks out that
 * directory alone.
 */
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/i;

export const linkedIssueNumber = (prBody: string | null | undefined): string =>
  (prBody ?? "").match(CLOSES)?.[1] ?? "";
