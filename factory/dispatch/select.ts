/**
 * Dispatcher selection: which open issues become factory tickets right now.
 *
 * Pure. Input is the tracker's open issues reduced to what the rules need;
 * output is the subset to label `agent:implement`. The human intent label is
 * `ready-for-agent`; `agent:*` and `needs-human` are factory state. A ticket
 * is dispatched when a human said it is ready, nothing open blocks it
 * (GitHub native dependencies, open blockers only), nobody holds it, and the
 * factory is not already on it.
 *
 * Imports use explicit `.ts` so the dispatch job can run on bare `node
 * --experimental-strip-types` without installing the engine.
 */

import {
  DEFAULT_TRUSTED_AUTHORS,
  isTrustedAuthor,
} from "../lib/trusted-authors.ts";

export { DEFAULT_TRUSTED_AUTHORS, parseTrustedAuthors } from "../lib/trusted-authors.ts";

export const READY_LABEL = "ready-for-agent";
export const DISPATCH_LABEL = "agent:implement";

/** A human claimed this work; the factory must never automate it. */
export const REFUSED_LABELS = ["ready-for-human", "needs-triage"] as const;

/** The factory already holds this ticket in some state. */
export const FACTORY_STATE_LABELS = [
  "agent:implement",
  "agent:in-progress",
  "agent:review",
  "agent:blocked",
  "needs-human",
] as const;

export type DispatchIssue = {
  number: number;
  /** Absent in a listing of open issues; set from a single-issue re-read. */
  state?: "open" | "closed";
  labels: readonly string[];
  assigned: boolean;
  /** Open blockers from `issue_dependencies_summary.blocked_by`. */
  openBlockers: number;
  /** Sub-issue count; a parent with children is a spec, not a ticket. */
  subIssues?: number;
  /** An open PR already says it closes this issue. */
  hasOpenPr: boolean;
  /** GitHub's `author_association` for whoever opened the issue. */
  authorAssociation: string;
};

/** The reason an issue is not dispatched, or undefined when it is. */
export const whySkipped = (
  issue: DispatchIssue,
  trustedAuthors: readonly string[] = DEFAULT_TRUSTED_AUTHORS,
): string | undefined => {
  const has = (label: string) => issue.labels.includes(label);
  if (issue.state === "closed") return "closed since the snapshot";
  if (!has(READY_LABEL)) return `no ${READY_LABEL}`;
  const refused = REFUSED_LABELS.find(has);
  if (refused) return `refused: ${refused}`;
  const state = FACTORY_STATE_LABELS.find(has);
  if (state) return `already in the factory: ${state}`;
  // After the label checks: a skipped ticket gets no comment, so its one log
  // line should name the state a human can act on, not the author.
  if (!isTrustedAuthor(issue.authorAssociation, trustedAuthors)) {
    return `untrusted author: ${issue.authorAssociation}`;
  }
  if (issue.assigned) return "assigned";
  if (issue.openBlockers > 0) {
    return `${issue.openBlockers} open blocker${issue.openBlockers === 1 ? "" : "s"}`;
  }
  if ((issue.subIssues ?? 0) > 0) return "has sub-issues, not a ticket";
  if (issue.hasOpenPr) return "an open PR already closes it";
  return undefined;
};

export const selectForDispatch = (
  issues: readonly DispatchIssue[],
  trustedAuthors: readonly string[] = DEFAULT_TRUSTED_AUTHORS,
): DispatchIssue[] =>
  issues.filter((issue) => whySkipped(issue, trustedAuthors) === undefined);

/**
 * Issue numbers that open PRs claim to close, from their bodies. Same
 * keywords GitHub honours; same test the implement workflow's preflight uses.
 */
export const issuesClosedByPrs = (
  prs: readonly { number: number; body: string | null }[],
): Set<number> => {
  const closed = new Set<number>();
  for (const pr of prs) {
    for (const match of (pr.body ?? "").matchAll(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi,
    )) {
      closed.add(Number(match[1]));
    }
  }
  return closed;
};

/**
 * Reduce GitHub's REST issue objects (`GET /repos/{o}/{r}/issues`) to the
 * dispatch shape. The endpoint lists PRs too; they are dropped.
 */
export const fromGitHub = (
  raw: readonly unknown[],
  closedByOpenPr: ReadonlySet<number>,
): DispatchIssue[] => {
  const issues: DispatchIssue[] = [];
  for (const item of raw) {
    const r = item as Record<string, any>;
    if (r.pull_request) continue;
    issues.push({
      number: Number(r.number),
      ...(r.state === "open" || r.state === "closed" ? { state: r.state } : {}),
      labels: (r.labels ?? []).map((label: { name: string }) => label.name),
      assigned: (r.assignees ?? []).length > 0,
      openBlockers: Number(r.issue_dependencies_summary?.blocked_by ?? 0),
      subIssues: Number(r.sub_issues_summary?.total ?? 0),
      hasOpenPr: closedByOpenPr.has(Number(r.number)),
      // Absent only on a payload GitHub no longer sends; read as an outsider.
      authorAssociation: String(r.author_association ?? "NONE").toUpperCase(),
    });
  }
  return issues;
};

/**
 * The listing the snapshot came from is eventually consistent: a ticket
 * closed, re-blocked, or picked up seconds earlier can still be listed as
 * dispatchable (#19: two closed tickets were labeled and implemented). Given
 * the issue re-read on its own (`GET /repos/{o}/{r}/issues/{n}`), the reason
 * not to label it now, or undefined when it is still dispatchable.
 */
export const whyNotDispatchableNow = (
  raw: unknown,
  closedByOpenPr: ReadonlySet<number>,
  trustedAuthors: readonly string[] = DEFAULT_TRUSTED_AUTHORS,
): string | undefined => {
  const [issue] = fromGitHub([raw], closedByOpenPr);
  return issue ? whySkipped(issue, trustedAuthors) : "not an issue";
};
