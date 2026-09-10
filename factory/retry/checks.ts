/**
 * The state of a PR head's checks, reduced to what the retry decision needs:
 * which are still pending, and which failed and of what kind. Statuses
 * (the statuses API: factory/verdict, factory/red-green,
 * factory/test-integrity, anything else posted there) and check runs (the
 * target's own Actions CI) are read together. Check runs that belong to the
 * factory's own caller workflow are not the target's CI: their failures are
 * ignored (the gate speaks through its statuses), but one still in progress
 * means the head is not judged yet, so it counts as pending. This very run
 * is skipped. The gate contexts are expected on every factory PR: until
 * they appear they are pending too, since the gate run may still be queued
 * when the review starts.
 */
import { NO_CRITERIA_DESCRIPTION } from "../lib/verdict";
import type { FailureKind, Mergeability } from "./decide";

export interface CommitStatus {
  readonly context: string;
  readonly state: string;
  readonly description?: string | null;
  readonly target_url?: string | null;
}

export interface CheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion?: string | null;
  readonly html_url?: string | null;
  /** The Actions workflow the run belongs to; undefined when unknown. */
  readonly workflowName?: string;
}

export interface CheckFailure {
  readonly name: string;
  readonly kind: FailureKind;
  readonly description: string;
  /** The run or job to pull a log excerpt from. */
  readonly url: string | null;
}

export interface CheckState {
  readonly pending: string[];
  readonly failures: CheckFailure[];
}

export const VERDICT_CONTEXT = "factory/verdict";
export const GATE_CONTEXTS: readonly string[] = ["factory/red-green", "factory/test-integrity"];

const FAILED_STATUS_STATES = new Set(["failure", "error"]);
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out"]);

/** Gate first, then the target's CI, then the verdict: the log is the more useful output. */
const KIND_ORDER: readonly FailureKind[] = ["gate", "ci", "verdict", "implement"];

export const runIdFromUrl = (url: string | null | undefined): string | undefined =>
  url?.match(/\/actions\/runs\/(\d+)(?:[/?#]|$)/)?.[1];

const statusKind = (context: string): FailureKind =>
  context === VERDICT_CONTEXT ? "verdict" : GATE_CONTEXTS.includes(context) ? "gate" : "ci";

export const evaluateChecks = (input: {
  readonly statuses: readonly CommitStatus[];
  readonly checkRuns: readonly CheckRun[];
  readonly own: { readonly workflowName: string; readonly runId: string };
}): CheckState => {
  const pending: string[] = [];
  const failures: CheckFailure[] = [];

  for (const status of input.statuses) {
    if (status.state === "pending") {
      pending.push(status.context);
    } else if (FAILED_STATUS_STATES.has(status.state)) {
      failures.push({
        name: status.context,
        kind: statusKind(status.context),
        description: status.description ?? "",
        url: status.target_url ?? null,
      });
    }
  }

  for (const context of GATE_CONTEXTS) {
    if (!input.statuses.some((status) => status.context === context)) pending.push(`${context} (not posted yet)`);
  }

  for (const run of input.checkRuns) {
    const runId = runIdFromUrl(run.html_url);
    if (runId === input.own.runId) continue;
    if (run.status !== "completed") {
      pending.push(run.name);
    } else if (run.workflowName === input.own.workflowName) {
      continue;
    } else if (FAILED_CONCLUSIONS.has(run.conclusion ?? "")) {
      failures.push({
        name: run.name,
        kind: "ci",
        description: run.conclusion ?? "",
        url: run.html_url ?? null,
      });
    }
  }

  failures.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return { pending, failures };
};

/**
 * Why no implementer run can fix these failures, or undefined. A verdict
 * that failed for want of acceptance criteria is the ticket's fault: a
 * retry would burn a run and fail the same way.
 */
export const unretryableReason = (failures: readonly CheckFailure[]): string | undefined =>
  failures.some((f) => f.kind === "verdict" && f.description === NO_CRITERIA_DESCRIPTION)
    ? `the ticket has no acceptance criteria (${NO_CRITERIA_DESCRIPTION}), so no implementer run can pass the verdict; add an "Acceptance criteria" checklist to the ticket`
    : undefined;

/**
 * Why a head is not the ticket's failure when the wait for its checks runs
 * out, or undefined when it is. A check still running has no log to inform a
 * retry: counted as a failure it spends the one informed retry on nothing
 * and the next failure escalates, so a slow target CI alone strands the
 * ticket. Requeued instead, with the retry count untouched. A check that
 * genuinely failed outranks a pending one: it has a log, so the retry is
 * informed and worth spending.
 */
export const stillPendingReason = (state: CheckState, timeoutMinutes: number): string | undefined =>
  state.failures.length === 0 && state.pending.length > 0
    ? `${state.pending.join(", ")} still pending after ${timeoutMinutes} minutes; not the ticket's failure`
    : undefined;

/**
 * Whether one poll's observation ends the wait for the head's checks, and
 * why. Settled checks end it: the failures among them, if any, are the
 * result. A definite conflict ends it early (#145): GitHub starts no
 * `pull_request` workflow on a conflicting PR, so the pending checks are not
 * coming, and the PR is the implementer's whatever the deadline says. The
 * reason names that early end, so the log does not claim a deadline that
 * never came; undefined when a failed check outranks it, as at the deadline.
 * UNKNOWN is GitHub still deciding and MERGEABLE is a head whose checks are
 * on their way: both keep waiting.
 */
export type WaitEnd =
  | { readonly over: false }
  | { readonly over: true; readonly why: "settled" }
  | { readonly over: true; readonly why: "conflict"; readonly reason: string | undefined };

export const waitEnd = (state: CheckState, mergeable: Mergeability | undefined): WaitEnd => {
  if (state.pending.length === 0) return { over: true, why: "settled" };
  if (mergeable === "CONFLICTING") {
    return {
      over: true,
      why: "conflict",
      reason:
        state.failures.length === 0
          ? `${state.pending.join(", ")} still pending when GitHub reported the PR conflicting with its base; the wait ended early, not at the deadline`
          : undefined,
    };
  }
  return { over: false };
};

export const summariseFailures = (failures: readonly CheckFailure[]): string =>
  failures
    .map((f) => `${f.kind} ${f.name}${f.description ? ` (${f.description})` : ""}`)
    .join("; ");

export interface GateArtifact {
  readonly redGreen?: { readonly ok?: boolean; readonly reasons?: readonly string[]; readonly exitCodes?: { base: number; head: number } };
  readonly testIntegrity?: { readonly ok?: boolean; readonly reasons?: readonly string[] };
}

/**
 * The gate's failing output, from the artifact its run uploaded: gate.json
 * carries each check's reasons, the red-green logs show the test runs on
 * main and on the head. The gate job itself fails on a one-line jq step, so
 * its failed-step log says nothing.
 */
export const renderGateOutput = (
  gate: GateArtifact,
  logs: { readonly base?: string; readonly head?: string },
  tailLines = 40,
): string => {
  const tail = (text: string | undefined): string =>
    (text ?? "").trim().split("\n").slice(-tailLines).join("\n") || "(empty)";
  const check = (name: string, result: { ok?: boolean; reasons?: readonly string[] } | undefined): string[] =>
    result
      ? [`${name}: ${result.ok ? "pass" : "fail"}`, ...(result.reasons ?? []).map((r) => `- ${r}`)]
      : [`${name}: (not in gate.json)`];
  const lines = [...check("factory/red-green", gate.redGreen), ...check("factory/test-integrity", gate.testIntegrity)];
  if (gate.redGreen?.exitCodes) {
    lines.push(
      "",
      `Changed tests on main (expected to fail), exit ${gate.redGreen.exitCodes.base}:`,
      tail(logs.base),
      "",
      `Changed tests on the head (expected to pass), exit ${gate.redGreen.exitCodes.head}:`,
      tail(logs.head),
    );
  }
  return lines.join("\n");
};
