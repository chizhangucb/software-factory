/**
 * Update-branch planning: which open PRs get their head brought up to date
 * with main after main moves, and which get a verdict carried forward.
 *
 * v0 stand-in for a merge queue (ADR 0003, fallback amendment): GitHub's
 * queue is unavailable on user-owned repos, so the factory requires
 * up-to-date branches and calls the update-branch API itself. No LLM
 * anywhere in this path; a conflict the API cannot resolve is handed to the
 * implementer (agent-implement-pr.yml).
 *
 * Every decision update-branch takes is here, and every one of them is pure:
 * PR state in, an action per PR out, and the answer to the one call the
 * script makes in, which of the two documented 422s it was out
 * (`updateRefusal`). The script spawns and writes; it decides nothing, so
 * nothing it decides goes untested.
 *
 * The one import is `lib/labels.ts`, which imports nothing itself and is in
 * this job's cone. Nothing else may be imported: `GhFailure` below is written
 * structurally rather than importing `lib/gh.ts`, so this stays the pure
 * decision half. Imports use explicit `.ts` so the job can run on bare
 * `node --experimental-strip-types` without installing the engine.
 */
import { HANDED_OFF_LABELS } from "../lib/labels.ts";

/** A commit status context, not a label: the reviewer's verdict on a head. */
export const VERDICT_CONTEXT = "factory/verdict";
/**
 * Posted on a head the moment the factory's update-branch call is accepted.
 * GitHub commits as web-flow for a conflict a person resolves in the web
 * editor too, so a merge only counts as an update when its first parent
 * carries this marker.
 */
export const UPDATE_MARKER_CONTEXT = "factory/update-branch";

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
  /** `exhausted`: the walk hit its hop limit before finding one. */
  state: CommitStatus["state"] | "none" | "exhausted";
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

export type PlanAction = "update" | "hand-off" | "skip";

export type Plan = {
  number: number;
  action: PlanAction;
  /** Post the passing verdict from `verdict.sha` on this head before anything else. */
  carry: boolean;
  reason: string;
};

/**
 * A merge commit GitHub made itself: two parents, committed by web-flow. The
 * shape of an update-branch merge, and also of a conflict resolved in the
 * web editor; `requestedByFactory` on the first parent tells them apart. A
 * merge a person or an agent pushed does not qualify, whatever its shape.
 */
export const isUpdateMerge = (head: HeadCommit): boolean =>
  head.parents.length === 2 && head.committerLogin === GITHUB_COMMITTER;

/** Whether the factory asked GitHub to update the branch from this head. */
export const requestedByFactory = (statuses: readonly CommitStatus[]): boolean =>
  statuses.some((s) => s.context === UPDATE_MARKER_CONTEXT && s.state === "success");

const verdictState = (statuses: readonly CommitStatus[]): CommitStatus["state"] | "none" =>
  statuses.find((s) => s.context === VERDICT_CONTEXT)?.state ?? "none";

/**
 * The verdict that governs a head: the one on the head itself, else the one
 * on the head the reviewer judged, reached by walking first parents through
 * update merges only. Each hop is GitHub merging main into the branch at the
 * factory's request, which leaves the PR's diff as it was; the walk stops
 * at the first commit a person or an agent made, and at a GitHub merge the
 * factory did not ask for (a conflict resolved in the web editor changes
 * the diff). Lookups are injected so the rule is pure.
 */
export const findVerdict = (
  head: HeadCommit,
  statusesOf: (sha: string) => readonly CommitStatus[],
  commitOf: (sha: string) => HeadCommit,
  maxHops = 10,
): Verdict => {
  const headState = verdictState(statusesOf(head.sha));
  if (headState !== "none") return { state: headState, sha: head.sha };
  let commit = head;
  for (let hop = 1; ; hop++) {
    if (!isUpdateMerge(commit)) return { state: "none", sha: head.sha };
    if (hop > maxHops) return { state: "exhausted", sha: head.sha };
    const parentSha = commit.parents[0]!;
    const parentStatuses = statusesOf(parentSha);
    if (!requestedByFactory(parentStatuses)) return { state: "none", sha: head.sha };
    const state = verdictState(parentStatuses);
    if (state !== "none") return { state, sha: parentSha };
    commit = commitOf(parentSha);
  }
};

/**
 * The two outcomes GitHub documents for the update-branch call that are
 * outcomes rather than failures: the merge conflicts, and the head moved
 * since the sha the call named. Both come back as a 422.
 */
export type UpdateRefusal = "conflict" | "head moved";

/**
 * The fields of a failed `gh` call this decision reads. Written structurally
 * rather than imported: `lib/gh.ts`'s `GhError` satisfies it, and this module
 * stays the pure decision half with no imports of its own.
 */
export type GhFailure = {
  readonly status: number | null;
  readonly stderr: string;
};

/** GitHub's own words for each refusal, as `gh` prints them on stderr. */
const REFUSALS: readonly (readonly [string, UpdateRefusal])[] = [
  ["merge conflict", "conflict"],
  ["expected head sha", "head moved"],
];

/**
 * Which documented 422 GitHub answered the update-branch call with, or
 * undefined for anything else, which is a real failure for the caller to
 * rethrow.
 *
 * Read from the failed call's own fields, never from a rendered message: the
 * status says the call ran and got an answer (a killed or unspawned call has
 * none), and stderr is that answer, the HTTP status code and the message
 * GitHub sent. The message on the error is prose for a human reading a job
 * log, and no decision is taken from it (#120).
 *
 * The HTTP status is asked for as `gh` prints it, `(HTTP 422)`, rather than
 * as a bare 422 that a PR number or a sha would also satisfy. If `gh` ever
 * renders it differently a real refusal stops being recognised here: the call
 * is rethrown, the run goes red, and the next run's scan reads the PR as
 * CONFLICTING and hands it off through `planConflict` anyway. Loud and
 * self-repairing, which is the direction to be wrong in.
 */
export const updateRefusal = (failure: GhFailure): UpdateRefusal | undefined => {
  if (failure.status === null) return undefined;
  const said = failure.stderr.toLowerCase();
  if (!said.includes("(http 422)")) return undefined;
  return REFUSALS.find(([words]) => said.includes(words))?.[1];
};

/**
 * A conflict decision: what to do and why. No `carry`: this decision never
 * sees a verdict, and the caller that has one has already acted on it.
 */
export type ConflictPlan = {
  number: number;
  action: Extract<PlanAction, "skip" | "hand-off">;
  reason: string;
};

/**
 * What to do with a PR that conflicts with its base. No API call resolves a
 * conflict, and no merge queue would either; the implementer does, on the
 * branch (agent-implement-pr.yml). Two decisions: a PR an agent already
 * holds is left alone, which is a `skip` whose reason names the label
 * holding it; one nobody holds is a `hand-off`, and the caller writes the
 * comment and the `agent:implement` label that send it to implement-pr.
 *
 * The one copy of this decision, and it does not depend on who found the
 * conflict. The plan reaches it through `planUpdate` before any call is made,
 * and `update-branch.ts` reaches it again when GitHub refuses the call it
 * made anyway (`mergeable: UNKNOWN` is tried); that caller says so in front
 * of the reason, since the refusal is its fact and not this decision's.
 */
export const planConflict = (
  pr: { readonly number: number; readonly labels: readonly string[] },
): ConflictPlan => {
  const held = pr.labels.find((l) => HANDED_OFF_LABELS.includes(l));
  return held
    ? { number: pr.number, action: "skip", reason: `conflicts with main, already ${held}` }
    : { number: pr.number, action: "hand-off", reason: "conflicts with main; handing the PR to the implementer" };
};

export const planUpdate = (pr: OpenPr): Plan => {
  const plan = (action: PlanAction, reason: string, carry = false): Plan =>
    ({ number: pr.number, action, carry, reason });
  if (!pr.autoMerge) return plan("skip", "auto-merge not enabled");
  // The conflict decision states no carry, and here there is none to state: a
  // conflicting PR is not updated, so nothing moves off the head a verdict sits on.
  if (pr.mergeable === "CONFLICTING") return { ...planConflict(pr), carry: false };
  const { verdict } = pr;
  // The reviewer is on this PR; moving the head now would strand the verdict on the
  // old sha. The review's dispatch triggers another run once it lands.
  if (verdict.state === "pending") return plan("skip", "reviewer running");
  // A failed verdict cannot merge whatever main does; the re-review's dispatch brings it back.
  if (verdict.state === "failure" || verdict.state === "error") {
    return plan("skip", `verdict ${verdict.state} on ${verdict.sha.slice(0, 7)}, waiting for a re-review`);
  }
  // Another update would only deepen the chain; a re-review puts a verdict back on the head.
  if (verdict.state === "exhausted") {
    return plan("skip", "no verdict within the update-merge walk limit; re-add agent:review to judge this head");
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
