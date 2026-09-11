/**
 * Retry and escalation (#16): what the factory does when a run fails.
 *
 * A run fails when the implementer run failed (no commits, an agent error),
 * or when the PR's merge gate (factory/red-green,
 * factory/test-integrity, the target's own CI) or factory/verdict came back
 * failing. The first failure earns one informed retry: the implementer runs
 * again on the same branch with the failing output in its prompt. A second
 * failure escalates: agent labels and ready-for-agent off, needs-human on,
 * branch kept, log linked, no open PR.
 *
 * Attempts are counted with a label on the ticket, `factory:retry-<n>`, so
 * the count survives across workflow runs and a human can see it. The
 * failing output travels as a marker comment on the ticket that the next
 * implementer run reads back. Pure functions here; `retry.ts` does the API
 * calls.
 */
import { BLOCKED_LABEL, ESCALATION_LABEL, IMPLEMENT_LABEL, READY_LABEL } from "../lib/labels.ts";
import { boundOutput } from "../lib/verdict";
import type { PrFixAction } from "./escalation.ts";

export type FailureKind = "implement" | "merge-gate" | "ci" | "verdict";

export const FAILURE_KINDS: readonly FailureKind[] = ["implement", "merge-gate", "ci", "verdict"];

/** Retries after the first attempt. One: the spec's retry cap. */
export const MAX_RETRIES = 1;

export const RETRY_LABEL_PREFIX = "factory:retry-";

export const retryLabel = (n: number): string => `${RETRY_LABEL_PREFIX}${n}`;

/** How many retries the ticket has used: the highest `factory:retry-<n>` label. */
export const retriesUsed = (labels: readonly string[]): number =>
  labels.reduce((max, label) => {
    if (!label.startsWith(RETRY_LABEL_PREFIX)) return max;
    const n = Number(label.slice(RETRY_LABEL_PREFIX.length));
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);

/**
 * Whether an attempt that ended this way is the implementer's own failure, so
 * it spends the ticket's one retry. GitHub's outcome for the step that ran the
 * implementer, or for the job when the step's outcome did not survive.
 *
 * `cancelled` is the job timeout (#51): `timeout-minutes` kills the job
 * mid-run, and an attempt killed while working is exactly what a retry is for.
 * Anything else failed around the implementer (a checkout, a push, the PR
 * step), which gets the blocked comment rather than burning the retry.
 */
export const isImplementerFailure = (outcome: string): boolean =>
  outcome === "failure" || outcome === "cancelled";

/**
 * What to report as the failure reason when the attempt wrote no reason file.
 * A cancelled attempt was killed rather than stopped by anything it could
 * write down (#51), so saying "no reason file" would read as a factory bug.
 */
export const missingFailureReason = (outcome: string): string =>
  outcome === "cancelled"
    ? "the run was killed before it could report a reason; a job timeout looks like this"
    : "(no reason file written; see the workflow log)";

/** Why a run that could not reach an account is not the ticket's failure. */
export const RATE_LIMITED_REASON = "rate limited on every account; not the ticket's failure";

/**
 * Written into the output dir when a PR was requeued (#148), for the workflow
 * steps that take `agent:in-progress` off on their way out: the one they must
 * not take it off for is a requeued PR. That label is what the reconciler
 * sweeps, so it is what gets the start label re-added at the stuck deadline;
 * a PR with no `agent:*` label is swept by nothing. A requeued ticket writes
 * no marker, having the opposite need: no factory label is what the
 * dispatcher picks up.
 */
export const REQUEUED_FILE = "requeued.txt";

/** A PR's mergeability as GitHub reports it (`gh pr view --json mergeable`); UNKNOWN while it is still computing. */
export type Mergeability = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type Decision =
  | { readonly action: "retry"; readonly retry: number }
  | { readonly action: "escalate"; readonly reason: string }
  /** Not the ticket's failure: hand it back to the queue without counting an attempt. */
  | { readonly action: "requeue"; readonly reason: string }
  /** The PR conflicts with its base: the implementer's to resolve, no attempt counted. */
  | { readonly action: "hand-off"; readonly reason: string }
  | { readonly action: "none"; readonly reason: string };

/** Why a conflicting PR whose checks never came goes to the implementer rather than to a human. */
export const CONFLICT_REASON =
  "the PR conflicts with its base, so GitHub started no merge gate on this head; the implementer resolves it";

/**
 * Retry or escalate. Every failure kind gets the same one retry; the kind
 * shapes the prompt and the escalation comment, not the count. An escalated
 * ticket is left alone so two failure handlers cannot escalate it twice. A
 * run rate limited on every account is requeued, not retried: the quota is
 * the problem, rotation (#17) is the answer, and the attempt does not count.
 * A head still pending when the wait for its checks runs out is requeued for
 * the same reason: nothing has failed yet, so there is no output to inform a
 * retry, and spending one on a slow target CI leaves only escalation. On a
 * PR a requeue means what it means on a ticket (#148): no `agent:blocked`,
 * and something that already sweeps picks the subject up again, the
 * reconciler at its stuck deadline. But when that PR
 * conflicts with its base (#144) the checks never came because GitHub runs
 * no merge gate on a conflicting PR, so it is handed to the implementer instead.
 * UNKNOWN mergeability is GitHub still deciding and is never acted on. A
 * real failure outranks the conflict, as a failed check outranks a pending
 * one. A failure a retry cannot fix (the ticket has no acceptance criteria)
 * escalates at once.
 */
export const decide = (input: {
  readonly retriesUsed: number;
  readonly kind: FailureKind;
  readonly escalated?: boolean;
  /** Why this attempt is not the ticket's failure, so it is handed back; undefined when it is. */
  readonly requeue?: string;
  /** The open PR's mergeability; undefined when there is no PR to read. */
  readonly mergeable?: Mergeability;
  /** Why another implementer run cannot fix this failure; undefined when it might. */
  readonly unretryable?: string;
}): Decision => {
  if (input.escalated) {
    return { action: "none", reason: `already escalated: ${ESCALATION_LABEL} is on the ticket` };
  }
  if (input.requeue) {
    if (input.mergeable === "CONFLICTING") return { action: "hand-off", reason: CONFLICT_REASON };
    return { action: "requeue", reason: input.requeue };
  }
  if (input.unretryable) {
    return { action: "escalate", reason: input.unretryable };
  }
  if (input.retriesUsed < MAX_RETRIES) {
    return { action: "retry", retry: input.retriesUsed + 1 };
  }
  const attempts = input.retriesUsed + 1;
  return {
    action: "escalate",
    reason: `the retry failed too (${attempts} attempts, ${MAX_RETRIES} retry allowed)`,
  };
};

export interface RetryContext {
  /** Which retry this context is for: 1 for the one retry, matching the `factory:retry-1` label. */
  readonly retry: number;
  readonly kind: FailureKind;
  readonly runUrl: string;
  /** The failing output: a reviewer checklist, a check's log excerpt, or the run's failure reason. */
  readonly output: string;
}

/**
 * What `renderRetryComment` is given: the context above plus which way the
 * open PR went (#183). Not part of `RetryContext` itself: that is what a later
 * implementer run reads back out of the comment, and by then the PR that
 * failed may be gone.
 */
export interface RetryCommentInput extends RetryContext {
  /** Default `hand-off`, the only answer there was before #183. */
  readonly action?: PrFixAction;
}

const MARKER = /^<!-- factory:retry retry=(\d+) kind=([a-z-]+) -->\n?/;
const RUN_LINE = /^Attempt \d+ failed \([a-z-]+\)\. Run: (\S+)$/m;
/** Fits a GitHub comment (64k) with room for the rest of the body. */
const OUTPUT_LIMITS = { head: 6_000, tail: 10_000 };

const fence = (text: string): string => {
  const longest = Math.max(2, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}text\n${text.trim()}\n${ticks}`;
};

/**
 * The failing output folded away at the end of a comment, bounded, or nothing
 * when there is none to show. Every comment that carries an output carries it
 * the same way, and `parseRetryComment` reads this shape back out of the
 * marker comment.
 */
const failureDetails = (output: string): string[] =>
  output.trim().length === 0
    ? []
    : ["", "<details><summary>Failure output</summary>", "", fence(boundOutput(output, OUTPUT_LIMITS)), "", "</details>"];

/**
 * The marker comment the failure handler posts on the ticket before the retry
 * starts. It records the attempt whoever fixes it (#183), so the count is the
 * same either way and nothing is dropped in silence; only the line saying what
 * happens next changes, because on a PR the factory did not author the answer
 * is "nothing of the factory's does".
 */
export const renderRetryComment = (context: RetryCommentInput): string =>
  [
    `<!-- factory:retry retry=${context.retry} kind=${context.kind} -->`,
    `### Retry ${context.retry} of ${MAX_RETRIES} requested by the factory`,
    "",
    `Attempt ${context.retry} failed (${context.kind}). Run: ${context.runUrl}`,
    "",
    context.action === "tell-author"
      ? `The factory did not author the open PR, so no implementer runs on its branch: the fix is its author's. The PR carries \`${BLOCKED_LABEL}\`, and taking that label off hands it back to the factory.`
      : "The implementer runs once more on the same branch with this output in its prompt; a second failure escalates to `needs-human`.",
    ...failureDetails(context.output),
  ].join("\n");

const isFailureKind = (value: string): value is FailureKind =>
  (FAILURE_KINDS as readonly string[]).includes(value);

/** Read a marker comment back; undefined for any other comment. */
export const parseRetryComment = (body: string): RetryContext | undefined => {
  const marker = body.match(MARKER);
  if (!marker || !isFailureKind(marker[2] ?? "")) return undefined;
  const rest = body.slice(marker[0].length);
  const details = rest.match(/<details><summary>Failure output<\/summary>\n\n([\s\S]*?)\n\n<\/details>\s*$/);
  const fenced = details?.[1] ?? "";
  const output = fenced.replace(/^`{3,}text\n/, "").replace(/\n`{3,}$/, "");
  return {
    retry: Number(marker[1]),
    kind: marker[2] as FailureKind,
    runUrl: rest.match(RUN_LINE)?.[1] ?? "",
    output,
  };
};

/**
 * The newest marker comment among a ticket's comments, oldest first, and
 * only while the ticket's `factory:retry-<n>` label says that retry is the
 * current one. A ticket handed back after an escalation (label removed)
 * starts a fresh cycle and its old marker is history.
 */
export const latestRetryContext = (
  commentBodies: readonly string[],
  labels: readonly string[],
): RetryContext | undefined => {
  const current = retriesUsed(labels);
  if (current === 0) return undefined;
  for (let i = commentBodies.length - 1; i >= 0; i--) {
    const parsed = parseRetryComment(commentBodies[i] ?? "");
    if (parsed) return parsed.retry === current ? parsed : undefined;
  }
  return undefined;
};

const KIND_GUIDANCE: Record<FailureKind, string> = {
  implement:
    "The output is the previous run's failure reason and the tail of its log. Find what stopped it and finish the ticket this time; do not repeat the same path.",
  "merge-gate": "The output is a failing check's log. Make that check pass: a new test must fail on main and pass here, a deleted test must be one the ticket removes, and no test may be skipped or narrowed.",
  ci: "The output is the target's own CI log. Make the CI pass without weakening it.",
  verdict:
    "The output is the reviewer's checklist. Every unticked criterion must be met, with evidence visible in the diff, before you finish.",
};

/** The prompt section an implementer gets on a retry; empty on a first attempt. */
export const retryPromptSection = (context: RetryContext | undefined): string => {
  if (!context) return "";
  return [
    "# RETRY: THE PREVIOUS ATTEMPT FAILED",
    "",
    `This is retry ${context.retry} of ${MAX_RETRIES} on this ticket (attempt ${context.retry + 1} of ${MAX_RETRIES + 1}). If it fails again the factory escalates to a human, so fix the cause of the failure first. Attempt ${context.retry} failed (${context.kind}). Run: ${context.runUrl}. The branch carries whatever the previous attempt committed.`,
    "",
    KIND_GUIDANCE[context.kind],
    "",
    fence(context.output),
    "",
  ].join("\n");
};

/**
 * The comment on a requeued ticket or PR: what happened and what moves it
 * next. The reason names the cause, so the heading stays true of every one
 * of them. A requeue means the same thing on both sides (#148): no retry
 * spent, no label of the factory's added, and something that already sweeps
 * picks the subject up again, the dispatcher on a ticket and the reconciler
 * on a PR. Neither is a human, so no requeue reaches `agent:blocked`, which
 * keeps its one meaning: a human must look. A PR that conflicts with its
 * base never gets this comment; it is the implementer's, and
 * `renderHandOffComment` says so.
 */
export const renderRequeueComment = (input: {
  readonly reason: string;
  readonly runUrl: string;
  /** The PR path has no dispatcher: the reconciler re-labels it at its stuck deadline. */
  readonly onPr: boolean;
}): string =>
  [
    "### Requeued without spending a retry",
    "",
    `${input.reason}. No retry was spent. Run: ${input.runUrl}`,
    "",
    input.onPr
      ? "This PR stays in `agent:in-progress` and nothing else is labeled. The reconciler re-adds `agent:review` at its stuck deadline, and the run starts again; the retry count is unchanged."
      : "No factory label is left on the ticket, so the dispatcher picks it up again on its next run (a label event or the schedule) once `agent:in-progress` is gone.",
  ].join("\n");

/**
 * The comment on a PR handed to the implementer because it conflicts with
 * its base (#144): the same hand-off update-branch makes on a conflict it
 * cannot resolve. Nothing here is for a human.
 */
export const renderHandOffComment = (input: {
  readonly reason: string;
  readonly base: string;
  readonly runUrl: string;
}): string =>
  [
    "### Handed to the implementer without spending a retry",
    "",
    `${input.reason}. No retry was spent. Run: ${input.runUrl}`,
    "",
    `Labeled \`${IMPLEMENT_LABEL}\`. Its run merges \`${input.base}\` into the branch, resolves the conflicts, and pushes; the merge gate and the review then judge the new head and auto-merge lands it.`,
  ].join("\n");

/**
 * The conflict as the PR's own author reads it (#183): the same fact
 * `CONFLICT_REASON` states, without the clause naming the implementer that is
 * not coming, and with the base named, since the merge is theirs to make.
 */
export const authorConflictReason = (base: string): string =>
  `the PR conflicts with \`${base}\`, so GitHub started no merge gate on this head`;

/** What the factory tells the author of a PR it will not put an implementer on (#183). */
export interface TellAuthorNote {
  /** What the factory found: the failure summary, or the conflict. */
  readonly reason: string;
  /** The ticket carrying the record, when the record went elsewhere; undefined when nothing else holds it. */
  readonly issueNumber: string | undefined;
  /** The failing output, when there is one this thread does not already carry. */
  readonly output: string;
}

/**
 * The comment on a PR the factory will not put an implementer on (#183), for
 * the PR's own thread. Both paths that would have labelled it
 * `agent:implement` post it: the retry after a failing check, and the conflict
 * hand-off.
 *
 * It is the whole of what its author gets, so it carries what failed rather
 * than a link to it: the retry's own record goes on the ticket, which is not
 * this author's thread and may not even be theirs to read. It also says what
 * the labels now say, because a PR whose `agent:*` labels vanished and that
 * acquired `needs-human` otherwise reads as the factory losing interest.
 *
 * What it does not say is "add `agent:review`". Taking `agent:blocked` off is
 * what actually hands the PR back, which is what #180's own tell-author
 * comment says, and telling a producer how to enter the **Judged path** is
 * #181's job rather than a failure comment's.
 */
export const renderTellAuthorComment = (input: TellAuthorNote & { readonly runUrl: string }): string =>
  [
    "### The fix is yours: the factory did not author this PR",
    "",
    `${input.reason}. Run: ${input.runUrl}`,
    "",
    `The factory puts an implementer only on a branch it opened, so nothing of the factory's will commit to this one. It carries \`${BLOCKED_LABEL}\` instead, which holds it here: no factory run picks it up again while that label is on.`,
    "",
    `Push the fix yourself, then take \`${BLOCKED_LABEL}\` off, which hands the PR back. Auto-merge is untouched, so a passing verdict still lands it.`,
    ...(input.issueNumber ? ["", `The attempt is recorded on #${input.issueNumber}.`] : []),
    ...failureDetails(input.output),
  ].join("\n");

/**
 * The PR that was open when the factory gave up, and what became of it.
 * Closing is `prEscalation`'s call, not this one's: escalation leaves a PR
 * the factory did not author open (#174), and the comment reports what
 * happened rather than deciding it.
 */
export interface EscalatedPr {
  readonly number: string;
  readonly closed: boolean;
}

/**
 * The comment on a PR escalation left open (#174), for the PR's own thread.
 * The escalation is recorded on the ticket, so without this the PR would show
 * its `agent:*` labels vanishing and say nothing about why. Posted only when
 * the record went elsewhere: with no ticket the escalation comment lands on
 * this PR already and a second one would repeat it.
 */
export const renderLeftOpenPrComment = (input: {
  readonly reason: string;
  readonly issueNumber: string;
  readonly runUrl: string;
}): string =>
  [
    "### Left open by the factory",
    "",
    `${input.reason}. The factory did not author this PR, so it is not the factory's to close.`,
    "",
    `Its \`agent:*\` labels are off and \`${ESCALATION_LABEL}\` is on, so no factory run picks it up again. The escalation is on #${input.issueNumber}. Run: ${input.runUrl}`,
  ].join("\n");

export interface EscalationInput {
  readonly issueNumber: string;
  readonly reason: string;
  /** One line per failure, for the top of the comment. */
  readonly summary: string;
  readonly runUrl: string;
  /** The uploaded run log artifact, when one was found. */
  readonly logUrl: string | undefined;
  readonly branch: string;
  readonly branchExists: boolean;
  /** The PR that was open when the factory gave up; undefined when none was. */
  readonly pr: EscalatedPr | undefined;
  readonly output: string;
}

/** The escalation comment on the ticket: the one thing a human reads. */
export const renderEscalationComment = (input: EscalationInput): string => {
  const branchLine = input.branchExists
    ? `Branch \`${input.branch}\` is kept for you.`
    : `No branch was pushed: no attempt made a commit.`;
  // Three outcomes, not two. A PR left open is the one a reader would
  // otherwise take for a PR that was closed, so it says which and why (#174):
  // the escalation happened, and only the closing did not.
  const prLine = !input.pr
    ? "No PR was open."
    : input.pr.closed
      ? `PR #${input.pr.number} was closed (auto-merge with it) so no open PR remains.`
      : `PR #${input.pr.number} is left open: the factory did not author it, so it is not the factory's to close. Its \`agent:*\` labels are off, \`${ESCALATION_LABEL}\` is on and auto-merge is disarmed, so no factory run picks it up again.`;
  const lines = [
    `## Escalated: \`${ESCALATION_LABEL}\``,
    "",
    `The factory gave up on #${input.issueNumber}: ${input.reason}.`,
    "",
    `- Last failure: ${input.summary}`,
    `- Run: ${input.runUrl}`,
    `- Run log: ${input.logUrl ?? "see the run"}`,
    `- ${branchLine} ${prLine}`,
    "",
    `To hand it back to the factory: fix the ticket, then remove \`${ESCALATION_LABEL}\` and \`${retryLabel(MAX_RETRIES)}\`, then add \`${READY_LABEL}\` back (escalation took it off). The dispatcher picks it up on the next event and the new run starts from main again${input.branchExists ? "; the kept branch is for reading" : ""}.`,
  ];
  lines.push(...failureDetails(input.output));
  return lines.join("\n");
};
