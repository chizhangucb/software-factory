/**
 * Update-branch planning: which open PRs get their head brought up to date
 * with main after main moves, and which get a verdict carried forward.
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

/** The login GitHub commits under when it makes a merge commit itself (update-branch, the merge button). */
export const GITHUB_COMMITTER = "web-flow";

export type HeadCommit = {
  sha: string;
  parents: readonly string[];
  committerLogin: string | null;
};

export type OpenPr = {
  number: number;
  /** GitHub's `autoMergeRequest` is set on the PR. GitHub refuses it on drafts, so this also means "not a draft". */
  autoMerge: boolean;
  /** Commits on main the head lacks, from the compare API. */
  behindBy: number;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  labels: readonly string[];
  /** State of the factory/verdict status on the head, or none. */
  verdictOnHead: "success" | "failure" | "pending" | "error" | "none";
  head: HeadCommit;
};

export type PlanAction = "update" | "escalate" | "skip";

export type Plan = {
  number: number;
  action: PlanAction;
  /** Post the first parent's passing verdict on this head before anything else. */
  carry: boolean;
  reason: string;
};

/**
 * An update-branch merge commit: two parents, committed by GitHub itself.
 * Its first parent is the head the reviewer judged; its second is main. A
 * merge a person or an agent pushed does not qualify, whatever its shape.
 */
export const isUpdateMerge = (head: HeadCommit): boolean =>
  head.parents.length === 2 && head.committerLogin === GITHUB_COMMITTER;

export const planUpdate = (pr: OpenPr): Plan => {
  const plan = (action: PlanAction, reason: string, carry = false): Plan =>
    ({ number: pr.number, action, carry, reason });
  if (!pr.autoMerge) return plan("skip", "auto-merge not enabled");
  if (pr.mergeable === "CONFLICTING") {
    return pr.labels.includes(BLOCKED_LABEL)
      ? plan("skip", `conflicts with main, already ${BLOCKED_LABEL}`)
      : plan("escalate", "conflicts with main");
  }
  // The reviewer is on this head; moving it now would strand the verdict on the old
  // sha. The verdict's status event triggers another run once it lands.
  if (pr.verdictOnHead === "pending") return plan("skip", "reviewer running on the head");
  // A failed verdict cannot merge whatever main does; the re-review's dispatch brings it back.
  if (pr.verdictOnHead === "failure" || pr.verdictOnHead === "error") {
    return plan("skip", `verdict ${pr.verdictOnHead} on the head, waiting for a re-review`);
  }
  // A head that update-branch made and that never got its verdict (a poll that timed
  // out, a race with the reviewer): carry before anything else, so a further update
  // still finds a verdict on its first parent.
  const carry = pr.verdictOnHead === "none" && isUpdateMerge(pr.head);
  const carryNote = carry ? `, verdict to carry from ${pr.head.parents[0]}` : "";
  if (pr.behindBy > 0) return plan("update", `${pr.behindBy} behind main${carryNote}`, carry);
  return plan("skip", `up to date${carryNote}`, carry);
};

export const planUpdates = (prs: readonly OpenPr[]): Plan[] =>
  [...prs].sort((a, b) => a.number - b.number).map(planUpdate);

export type CommitStatus = {
  context: string;
  state: "success" | "failure" | "pending" | "error";
  description: string | null;
  target_url: string | null;
};

const STATUS_DESCRIPTION_LIMIT = 140;

/**
 * The verdict to post on the new head after an update, or undefined. The
 * reviewer judged the PR's diff against its ticket; GitHub merging main into
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
