/**
 * Update-branch planning: which open PRs get their head brought up to date
 * with main after main moves.
 *
 * v0 stand-in for a merge queue (ADR 0003, fallback amendment): GitHub's
 * queue is unavailable on user-owned repos, so the factory requires
 * up-to-date branches and calls the update-branch API itself. Pure: PR
 * state in, an action per PR out. No LLM anywhere in this path; a conflict
 * the API cannot resolve is escalated for #16.
 *
 * Imports use explicit `.ts` so the job can run on bare
 * `node --experimental-strip-types` without installing the engine.
 */

export const BLOCKED_LABEL = "agent:blocked";
export const VERDICT_CONTEXT = "factory/verdict";

export type OpenPr = {
  number: number;
  isDraft: boolean;
  /** GitHub's `autoMergeRequest` is set on the PR. */
  autoMerge: boolean;
  /** Commits on main the head lacks, from the compare API. */
  behindBy: number;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  labels: readonly string[];
};

export type PlanAction = "update" | "escalate" | "skip";

export type Plan = {
  number: number;
  action: PlanAction;
  reason: string;
};

/** Why a PR is not updated right now, or undefined when it is. */
export const whyNotUpdated = (pr: OpenPr): string | undefined => {
  if (!pr.autoMerge) return "auto-merge not enabled";
  if (pr.isDraft) return "draft";
  if (pr.behindBy === 0) return "up to date";
  if (pr.mergeable === "CONFLICTING") {
    return pr.labels.includes(BLOCKED_LABEL)
      ? `conflicts with main, already ${BLOCKED_LABEL}`
      : "conflicts with main";
  }
  return undefined;
};

export const planUpdates = (prs: readonly OpenPr[]): Plan[] =>
  [...prs]
    .sort((a, b) => a.number - b.number)
    .map((pr) => {
      const reason = whyNotUpdated(pr);
      if (reason === undefined) return { number: pr.number, action: "update", reason: `${pr.behindBy} behind main` };
      const escalate = reason === "conflicts with main";
      return { number: pr.number, action: escalate ? "escalate" : "skip", reason };
    });

export type CommitStatus = {
  context: string;
  state: "success" | "failure" | "pending" | "error";
  description: string | null;
  target_url: string | null;
};

const STATUS_DESCRIPTION_LIMIT = 140;

/**
 * The verdict to post on the new head after an update, or undefined. The
 * reviewer judged the PR's diff against its ticket; a merge of main into
 * the head leaves that diff as it was, so a passing verdict carries over
 * with its provenance in the description. The gate and the target's own
 * CI re-run for real on the new head. Anything but success stays behind.
 */
export const carriedVerdict = (
  statuses: readonly CommitStatus[],
  oldHeadSha: string,
): CommitStatus | undefined => {
  const verdict = statuses.find((s) => s.context === VERDICT_CONTEXT);
  if (!verdict || verdict.state !== "success") return undefined;
  const suffix = ` (carried from ${oldHeadSha.slice(0, 7)} by update-branch)`;
  const room = STATUS_DESCRIPTION_LIMIT - suffix.length;
  const base = (verdict.description ?? "").slice(0, room);
  return { ...verdict, description: `${base}${suffix}` };
};
