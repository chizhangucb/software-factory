/**
 * Retry and escalation (#16): what the factory does when a run fails.
 *
 * A run fails when the implementer run failed (no commits, an agent error,
 * the turn cap), or when the PR's gate (factory/red-green,
 * factory/test-integrity, the target's own CI) or factory/verdict came back
 * failing. The first failure earns one informed retry: the implementer runs
 * again on the same branch with the failing output in its prompt. A second
 * failure escalates: agent labels off, needs-human on, branch kept, log
 * linked, no open PR.
 *
 * Attempts are counted with a label on the ticket, `factory:retry-<n>`, so
 * the count survives across workflow runs and a human can see it. The
 * failing output travels as a marker comment on the ticket that the next
 * implementer run reads back. Pure functions here; `retry.ts` does the API
 * calls.
 */
import { boundOutput } from "../lib/verdict";

export type FailureKind = "implement" | "gate" | "ci" | "verdict";

export const FAILURE_KINDS: readonly FailureKind[] = ["implement", "gate", "ci", "verdict"];

/** Retries after the first attempt. One: the spec's retry cap. */
export const MAX_RETRIES = 1;

export const RETRY_LABEL_PREFIX = "factory:retry-";
export const ESCALATION_LABEL = "needs-human";
const AGENT_LABEL_PREFIX = "agent:";

export const retryLabel = (n: number): string => `${RETRY_LABEL_PREFIX}${n}`;

/** How many retries the ticket has used: the highest `factory:retry-<n>` label. */
export const retriesUsed = (labels: readonly string[]): number =>
  labels.reduce((max, label) => {
    if (!label.startsWith(RETRY_LABEL_PREFIX)) return max;
    const n = Number(label.slice(RETRY_LABEL_PREFIX.length));
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);

export type Decision =
  | { readonly action: "retry"; readonly retry: number }
  | { readonly action: "escalate"; readonly reason: string }
  /** Not the ticket's failure: hand it back to the queue without counting an attempt. */
  | { readonly action: "requeue"; readonly reason: string }
  | { readonly action: "none"; readonly reason: string };

/**
 * Retry or escalate. Every failure kind gets the same one retry; the kind
 * shapes the prompt and the escalation comment, not the count. An escalated
 * ticket is left alone so two failure handlers cannot escalate it twice. A
 * run rate limited on every account is requeued, not retried: the quota is
 * the problem, rotation (#17) is the answer, and the attempt does not count.
 * A failure a retry cannot fix (the ticket has no acceptance criteria)
 * escalates at once.
 */
export const decide = (input: {
  readonly retriesUsed: number;
  readonly kind: FailureKind;
  readonly escalated?: boolean;
  readonly rateLimited?: boolean;
  /** Why another implementer run cannot fix this failure; undefined when it might. */
  readonly unretryable?: string;
}): Decision => {
  if (input.escalated) {
    return { action: "none", reason: `already escalated: ${ESCALATION_LABEL} is on the ticket` };
  }
  if (input.rateLimited) {
    return { action: "requeue", reason: "rate limited on every account; not the ticket's failure" };
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

/** Labels to take off and put on when escalating: every agent:* label goes. */
export const escalationLabels = (
  labels: readonly string[],
): { readonly remove: string[]; readonly add: string } => ({
  remove: labels.filter((label) => label.startsWith(AGENT_LABEL_PREFIX)),
  add: ESCALATION_LABEL,
});

export interface RetryContext {
  /** Which retry this context is for: 1 for the one retry, matching the `factory:retry-1` label. */
  readonly retry: number;
  readonly kind: FailureKind;
  readonly runUrl: string;
  /** The failing output: a reviewer checklist, a check's log excerpt, or the run's failure reason. */
  readonly output: string;
}

const MARKER = /^<!-- factory:retry retry=(\d+) kind=([a-z]+) -->\n?/;
const RUN_LINE = /^Attempt \d+ failed \([a-z]+\)\. Run: (\S+)$/m;
/** Fits a GitHub comment (64k) with room for the rest of the body. */
const OUTPUT_LIMITS = { head: 6_000, tail: 10_000 };

const fence = (text: string): string => {
  const longest = Math.max(2, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}text\n${text.trim()}\n${ticks}`;
};

/** The marker comment the failure handler posts on the ticket before the retry starts. */
export const renderRetryComment = (context: RetryContext): string =>
  [
    `<!-- factory:retry retry=${context.retry} kind=${context.kind} -->`,
    `### Retry ${context.retry} of ${MAX_RETRIES} requested by the factory`,
    "",
    `Attempt ${context.retry} failed (${context.kind}). Run: ${context.runUrl}`,
    "",
    "The implementer runs once more on the same branch with this output in its prompt; a second failure escalates to `needs-human`.",
    "",
    "<details><summary>Failure output</summary>",
    "",
    fence(boundOutput(context.output, OUTPUT_LIMITS)),
    "",
    "</details>",
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
  gate: "The output is a failing check's log. Make that check pass: a new test must fail on main and pass here, and no test may be deleted, skipped, or narrowed.",
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

/** The comment on a requeued ticket or PR: what happened and what moves it next. */
export const renderRequeueComment = (input: {
  readonly reason: string;
  readonly runUrl: string;
  /** The PR path has no dispatcher: a human re-adds the label once quota is back. */
  readonly onPr: boolean;
}): string =>
  [
    "### Rate limited on every account",
    "",
    `${input.reason}. No retry was spent. Run: ${input.runUrl}`,
    "",
    input.onPr
      ? "Labeled `agent:blocked`. Re-add `agent:implement` once the accounts have quota again; the retry count is unchanged."
      : "No factory label is left on the ticket, so the dispatcher picks it up again on its next run (a label event or the schedule) once `agent:in-progress` is gone.",
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
  readonly closedPr: string | undefined;
  readonly output: string;
}

/** The escalation comment on the ticket: the one thing a human reads. */
export const renderEscalationComment = (input: EscalationInput): string => {
  const branchLine = input.branchExists
    ? `Branch \`${input.branch}\` is kept for you.`
    : `No branch was pushed: no attempt made a commit.`;
  const prLine = input.closedPr
    ? `PR #${input.closedPr} was closed (auto-merge with it) so no open PR remains.`
    : "No PR was open.";
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
    `To hand it back to the factory: fix the ticket, then remove \`${ESCALATION_LABEL}\` and \`${retryLabel(MAX_RETRIES)}\`. The dispatcher picks it up on the next event and the new run starts from main again${input.branchExists ? "; the kept branch is for reading" : ""}.`,
  ];
  if (input.output.trim().length > 0) {
    lines.push(
      "",
      "<details><summary>Failure output</summary>",
      "",
      fence(boundOutput(input.output, OUTPUT_LIMITS)),
      "",
      "</details>",
    );
  }
  return lines.join("\n");
};
