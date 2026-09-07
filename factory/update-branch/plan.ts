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

export type CommitStatus = {
  context: string;
  state: "success" | "failure" | "pending" | "error";
  description: string | null;
  target_url: string | null;
};

/** The factory/verdict that governs a head, and the commit it sits on (see findVerdict). */
export type Verdict = {
  state: CommitStatus["state"] | "none";
  sha: string;
};

export type OpenPr = {
  number: number;
  /** GitHub's `autoMergeRequest` is set on the PR. GitHub refuses it on drafts, so this also means "not a draft". */
  autoMerge: boolean;
  /** Commits on main the head lacks, from the compare API. */
  behindBy: number;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  labels: readonly string[];
  head: HeadCommit;
  verdict: Verdict;
};

export type PlanAction = "update" | "escalate" | "skip";

export type Plan = {
  number: number;
  action: PlanAction;
  /** Post the passing verdict from `verdict.sha` on this head before anything else. */
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

const verdictState = (statuses: readonly CommitStatus[]): Verdict["state"] =>
  statuses.find((s) => s.context === VERDICT_CONTEXT)?.state ?? "none";

/**
 * The verdict that governs a head: the one on the head itself, else the one
 * on the head the reviewer judged, reached by walking first parents through
 * update merges only. Each hop is GitHub merging main into the branch, which
 * leaves the PR's diff as it was; the walk stops at the first commit a
 * person or an agent made. Lookups are injected so the rule is pure.
 */
export const findVerdict = (
  head: HeadCommit,
  statusesOf: (sha: string) => readonly CommitStatus[],
  commitOf: (sha: string) => HeadCommit,
  maxHops = 10,
): Verdict => {
  let commit = head;
  for (let hop = 0; hop <= maxHops; hop++) {
    const state = verdictState(statusesOf(commit.sha));
    if (state !== "none") return { state, sha: commit.sha };
    if (!isUpdateMerge(commit) || hop === maxHops) break;
    commit = commitOf(commit.parents[0]!);
  }
  return { state: "none", sha: head.sha };
};

export const planUpdate = (pr: OpenPr): Plan => {
  const plan = (action: PlanAction, reason: string, carry = false): Plan =>
    ({ number: pr.number, action, carry, reason });
  if (!pr.autoMerge) return plan("skip", "auto-merge not enabled");
  if (pr.mergeable === "CONFLICTING") {
    return pr.labels.includes(BLOCKED_LABEL)
      ? plan("skip", `conflicts with main, already ${BLOCKED_LABEL}`)
      : plan("escalate", "conflicts with main");
  }
  const { verdict } = pr;
  // The reviewer is on this PR; moving the head now would strand the verdict on the
  // old sha. The review's dispatch triggers another run once it lands.
  if (verdict.state === "pending") return plan("skip", "reviewer running");
  // A failed verdict cannot merge whatever main does; the re-review's dispatch brings it back.
  if (verdict.state === "failure" || verdict.state === "error") {
    return plan("skip", `verdict ${verdict.state} on ${verdict.sha.slice(0, 7)}, waiting for a re-review`);
  }
  // A passing verdict that sits below the head (a poll that timed out, a race with the
  // reviewer): carry before anything else, so a further update finds it on the parent.
  const carry = verdict.state === "success" && verdict.sha !== pr.head.sha;
  const carryNote = carry ? `, verdict to carry from ${verdict.sha.slice(0, 7)}` : "";
  if (pr.behindBy > 0) return plan("update", `${pr.behindBy} behind main${carryNote}`, carry);
  return plan("skip", `up to date${carryNote}`, carry);
};

export const planUpdates = (prs: readonly OpenPr[]): Plan[] =>
  [...prs].sort((a, b) => a.number - b.number).map(planUpdate);

const STATUS_DESCRIPTION_LIMIT = 140;
const CARRIED_SUFFIX = / \(carried from [0-9a-f]+ by update-branch\)$/;

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
  // A verdict carried twice keeps one note, not a chain of them.
  const base = (verdict.description ?? "").replace(CARRIED_SUFFIX, "").slice(0, room);
  return { ...verdict, description: `${base}${suffix}` };
};
