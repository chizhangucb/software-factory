/**
 * What the audit posts (#18): the result comment on the merged PR, and on a
 * miss the revert PR body and the needs-human issue body. Pure over the
 * resolved verdict; `audit.ts` gathers, the workflow posts.
 */
import type { Verdict } from "../shared/verdict";
import { verdictDescription } from "../shared/verdict";

export const AUDIT_MARKER = "<!-- factory:audit -->";

export interface PlaceholderFinding {
  readonly path: string;
  readonly line?: number;
  readonly description: string;
}

export interface AuditResult {
  readonly verdict: Verdict;
  readonly placeholders: readonly PlaceholderFinding[];
  readonly summary: string;
}

/** A miss: any criterion unmet, or a placeholder found. Either reverts. */
export const isMiss = (result: AuditResult): boolean =>
  result.verdict.verdict !== "pass" || result.placeholders.length > 0;

export const missReason = (result: AuditResult): string => {
  const unmet = result.verdict.criteria.filter((c) => !c.met).length;
  const parts: string[] = [];
  if (result.verdict.criteria.length === 0) parts.push("no acceptance criteria to judge against");
  else if (unmet > 0) parts.push(`${unmet} of ${result.verdict.criteria.length} acceptance criteria unmet`);
  if (result.placeholders.length > 0) parts.push(`${result.placeholders.length} placeholder(s) found`);
  return parts.join(", ") || "audit passed";
};

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ").trim();

export interface AuditContext {
  readonly prNumber: string;
  readonly issueNumber: string;
  readonly mergeSha: string;
  readonly model: string;
  readonly ordinal: number;
  readonly limit: number;
  readonly runUrl: string;
  /** The rendered usage table for the audit run, appended when present. */
  readonly usageSection?: string;
}

export const renderAuditComment = (result: AuditResult, ctx: AuditContext): string => {
  const miss = isMiss(result);
  const lines = [
    AUDIT_MARKER,
    `## Audit: ${miss ? "miss" : "pass"}`,
    "",
    `Merged factory PR ${ctx.ordinal} of the first ${ctx.limit}. Audited ${ctx.mergeSha.slice(0, 7)} against the acceptance criteria of #${ctx.issueNumber || "(none)"} with ${ctx.model}, read-only. ${verdictDescription(result.verdict)}, ${result.placeholders.length} placeholder(s). Run: ${ctx.runUrl}`,
    "",
  ];
  if (result.verdict.criteria.length === 0) {
    lines.push("No acceptance criteria were found on the ticket, so nothing could be ticked.");
  }
  for (const c of result.verdict.criteria) {
    lines.push(`- [${c.met ? "x" : " "}] ${oneLine(c.criterion)}. Evidence: ${oneLine(c.evidence)}`);
  }
  if (result.placeholders.length > 0) {
    lines.push("", "Placeholders:");
    for (const p of result.placeholders) {
      lines.push(`- \`${p.path}${p.line ? `:${p.line}` : ""}\`: ${oneLine(p.description)}`);
    }
  }
  lines.push("", oneLine(result.summary));
  if (miss) {
    lines.push(
      "",
      `Miss: ${missReason(result)}. A revert PR and a needs-human issue follow; nothing merges by itself.`,
    );
  }
  if (ctx.usageSection) lines.push("", ctx.usageSection);
  return lines.join("\n");
};

export interface MissLinks {
  readonly prNumber: string;
  readonly prTitle: string;
  readonly mergeSha: string;
  readonly auditCommentUrl: string;
  readonly revertPrUrl?: string;
  /** Set when `git revert` could not apply cleanly; the issue says so. */
  readonly revertFailure?: string;
  readonly runUrl: string;
}

export const renderRevertPrBody = (result: AuditResult, links: MissLinks): string =>
  [
    `Reverts #${links.prNumber} (${links.mergeSha.slice(0, 7)}): the first-20 audit found a miss, ${missReason(result)}.`,
    "",
    `Audit: ${links.auditCommentUrl}`,
    `Run: ${links.runUrl}`,
    "",
    "Opened by the software factory's audit. Not auto-merged: a human decides whether to revert or to fix forward.",
  ].join("\n");

export const renderNeedsHumanIssue = (
  result: AuditResult,
  links: MissLinks,
): { title: string; body: string } => ({
  title: `Audit miss: PR #${links.prNumber} ${links.prTitle}`.slice(0, 256),
  body: [
    `The first-20 audit re-reviewed merged PR #${links.prNumber} and found a miss: ${missReason(result)}.`,
    "",
    `- PR: #${links.prNumber} (merged as ${links.mergeSha.slice(0, 7)})`,
    `- Audit comment: ${links.auditCommentUrl}`,
    links.revertPrUrl
      ? `- Revert PR: ${links.revertPrUrl} (not auto-merged)`
      : `- Revert PR: none, \`git revert\` did not apply cleanly: ${links.revertFailure ?? "unknown"}. Revert by hand or fix forward.`,
    `- Run: ${links.runUrl}`,
    "",
    "Decide: merge the revert, or fix forward and close it. Close this issue when done.",
  ].join("\n"),
});
