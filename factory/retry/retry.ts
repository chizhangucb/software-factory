/**
 * The failure handler the workflows run when an attempt fails (#16). Reads
 * the ticket's retry count, decides with `decide.ts`, and acts:
 *
 * - retry: post the failing output as a marker comment on the ticket, add
 *   `factory:retry-<n>`, and label `agent:implement` (on the PR when one is
 *   open, so implement-pr runs on the branch; on the ticket otherwise).
 * - escalate: agent:* and ready-for-agent off the ticket, needs-human on, the
 *   open PR's agent:* labels off, the branch kept, a comment on the ticket
 *   linking the run and its log. The PR is closed only when the factory
 *   authored it (#174): closing a factory PR is free, since the ticket still
 *   holds the work and a later run opens a fresh one, but closing a PR a
 *   person or an outside agent wrote throws away work nothing can recreate.
 *   One left open still escalates in every other respect, and gets
 *   `needs-human` and its auto-merge disarmed, which is what closing would
 *   otherwise have done for it.
 * - requeue (rate limited on every account (#17), or a check still pending
 *   when the wait runs out): no retry spent, and one meaning on both sides
 *   (#148). The subject gets a comment and nothing is labeled for a human: a
 *   ticket is left with no factory label for the dispatcher, a PR in
 *   `agent:in-progress` for the reconciler, which re-adds its start label at
 *   the stuck deadline. So no requeue reaches `agent:blocked`, which keeps
 *   its one meaning: a human must look.
 * - hand-off (#144): the checks were still pending, but the PR conflicts
 *   with its base. GitHub starts no `pull_request` workflow on a conflicting
 *   PR, so the checks that never posted are a fact about the merge, not the
 *   ticket. The PR gets a comment naming the cause and `agent:implement`,
 *   as update-branch's conflict hand-off does: no retry spent, no
 *   `factory:retry-<n>`, no human. The wait reads mergeability on every poll
 *   and ends the moment GitHub reports a definite conflict (#145), rather
 *   than at the deadline. A mergeability GitHub has not decided yet
 *   (UNKNOWN) is never acted on: it keeps waiting, and at the deadline it
 *   stays a requeue.
 *
 * Two tokens: reads (statuses, check runs, run logs and artifacts, labels)
 * use GH_TOKEN, the job's GITHUB_TOKEN, which needs checks: read and
 * actions: read from the caller. Writes (labels, comments, closing the PR)
 * use FACTORY_PAT so the labels fire events; that PAT cannot read statuses.
 *
 * Env: GH_REPO, GH_TOKEN, FACTORY_PAT, BRANCH, RUN_URL, OUTPUT_DIR, one of
 * ISSUE_NUMBER or PR_NUMBER, and FAILURE_KIND:
 * - `implement`: the implementer's attempt ended badly; the output is
 *   OUTPUT_DIR/failure_reason.txt plus the tail of the newest run log.
 *   OUTPUT_DIR/rate_limited.txt present means every account was rate limited.
 *   IMPLEMENTER_OUTCOME is how the attempt ended, and only an attempt that
 *   failed or was killed spends a retry; anything else, an attempt that never
 *   started included, exits 1 so the calling job posts its blocked comment (#51).
 * - `checks`: a verdict was just posted on HEAD_SHA; wait for the head's
 *   other checks to settle (CHECKS_TIMEOUT_MINUTES, default 15), or for
 *   GitHub to report the PR conflicting, then fail on any failing status or
 *   check run. A check still pending at the deadline with nothing failed is
 *   requeued rather than failed: it has no log, so a retry on it is
 *   uninformed; when the open PR conflicts with its base it is handed off
 *   instead, as soon as the conflict is definite. No failure means nothing
 *   to do.
 * Optional: ARTIFACT_NAME for the log link, GITHUB_RUN_ID and
 * GITHUB_WORKFLOW (set by the runner) to ignore the factory's own check runs.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RATE_LIMITED_FILE } from "../lib/accounts";
import { gh, outputDir, required } from "../agent-workflows/shared/common";
import { errorMessage } from "../lib/errors";
import { linkedIssueNumber } from "../lib/linked-issue";
import { SECTION_END, SECTION_START, boundOutput } from "../lib/verdict";
import {
  type CheckFailure,
  type CheckRun,
  type CommitStatus,
  evaluateChecks,
  type MergeGateArtifact,
  renderMergeGateOutput,
  runIdFromUrl,
  stillPendingReason,
  summariseFailures,
  unretryableReason,
  waitOver,
} from "./checks";
import { ESCALATION_LABEL, IMPLEMENT_LABEL, IN_PROGRESS_LABEL } from "../lib/labels.ts";
import { type FactoryPrFacts } from "../lib/factory-pr.ts";
import { escalationLabels, prEscalation } from "./escalation.ts";
import {
  decide,
  type EscalatedPr,
  type FailureKind,
  isImplementerFailure,
  MAX_RETRIES,
  type Mergeability,
  missingFailureReason,
  RATE_LIMITED_REASON,
  renderEscalationComment,
  renderHandOffComment,
  renderLeftOpenPrComment,
  renderRequeueComment,
  renderRetryComment,
  REQUEUED_FILE,
  retriesUsed,
  retryLabel,
} from "./decide";

const REPO = required("GH_REPO");
const FACTORY_PAT = required("FACTORY_PAT");
const BRANCH = required("BRANCH");
const RUN_URL = required("RUN_URL");
const FAILURE_KIND = required("FAILURE_KIND");
const ISSUE_INPUT = process.env.ISSUE_NUMBER || undefined;
const PR_INPUT = process.env.PR_NUMBER || undefined;
const RUN_ID = process.env.GITHUB_RUN_ID ?? "";
const WORKFLOW = process.env.GITHUB_WORKFLOW ?? "";
const ARTIFACT_NAME = process.env.ARTIFACT_NAME;
const CHECKS_TIMEOUT_MS = Number(process.env.CHECKS_TIMEOUT_MINUTES || 15) * 60_000;
const POLL_MS = 20_000;

const LOG_TAIL_LINES = 120;
const LOG_LIMITS = { head: 2_000, tail: 8_000 };

const readIf = (file: string): string | undefined =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ghJson = <T>(args: string[]): T => JSON.parse(gh(args)) as T;

/** A write with FACTORY_PAT: labels it adds fire events, GITHUB_TOKEN's do not. */
const ghWrite = (args: string[]): string =>
  gh(args, { ...process.env, GH_TOKEN: FACTORY_PAT, GITHUB_TOKEN: FACTORY_PAT });

/**
 * A gh call whose failure is logged and shrugged off. No label is built for
 * it: the error names its own command and cause (`GhError` in `lib/gh.ts`),
 * and it names the whole command rather than the first three arguments.
 */
const attempt = (call: () => string): string | undefined => {
  try {
    return call();
  } catch (error) {
    console.log(errorMessage(error));
    return undefined;
  }
};
const tryGh = (args: string[]): string | undefined => attempt(() => gh(args));
const tryWrite = (args: string[]): string | undefined => attempt(() => ghWrite(args));

/**
 * An open PR for the branch: its number, and the facts that place it. One
 * object and not two fields, so there is no state where the number is known
 * and the facts are not; escalation has to ask `prEscalation` whether the
 * factory authored this PR before it may close it (#174), and a call site
 * that could hold a number without facts would need a fallback for a case
 * that cannot happen.
 */
interface OpenPr {
  readonly number: string;
  readonly facts: FactoryPrFacts;
}

interface Target {
  readonly issue: string | undefined;
  /** An open PR for the branch, when there is one. */
  readonly pr: OpenPr | undefined;
}

/**
 * The one thing an action is taken on: a ticket or a PR, named the way the
 * sweep names one (`Subject` in `dispatch/reconcile.ts`). Not imported from
 * there: that module is the dispatch job's, and it numbers its subjects with
 * a number, while every number here is the string the workflow handed over,
 * which is also the `gh` argument.
 *
 * A retry has two subjects at once, the one that records it and the one whose
 * label starts the next run, so which is which has to be readable at every
 * call site rather than positional.
 */
interface Subject {
  readonly kind: "issue" | "pr";
  readonly number: string;
}

/**
 * Where the record of this run goes: a comment, the retry label, the
 * escalation labels. The ticket when there is one, since that is what outlives
 * the PR and what a human reads; the PR only when no ticket was found.
 */
const recordOn = (target: Target): Subject =>
  target.issue ? { kind: "issue", number: target.issue } : { kind: "pr", number: (target.pr as OpenPr).number };

/**
 * What a label has to go on to move the factory: the open PR when there is
 * one, so implement-pr runs on the branch, and the ticket otherwise. The
 * mirror of `recordOn`, and the reason the two are named rather than repeated:
 * a retry uses both at once.
 */
const actOn = (target: Target): Subject =>
  target.pr ? { kind: "pr", number: target.pr.number } : { kind: "issue", number: target.issue as string };

/**
 * The ticket and its open PR from whichever number the workflow knows.
 * `headRefName` comes back on both reads, because the facts escalation judges
 * the PR on have to be the ones from the read that found it (#174): asking
 * GitHub again later is one more call that can fail, on a step whose failure
 * would fall back to closing.
 */
const resolveTarget = (): Target => {
  const openPr = (number: string, pr: { headRefName: string; body: string | null }): OpenPr => ({
    number,
    facts: { headRef: pr.headRefName, body: pr.body ?? "" },
  });
  if (PR_INPUT) {
    const pr = ghJson<{ state: string; body: string | null; headRefName: string }>([
      "pr", "view", PR_INPUT, "--repo", REPO, "--json", "state,body,headRefName",
    ]);
    const issue = ISSUE_INPUT ?? linkedIssueNumber(pr.body) ?? undefined;
    return { issue: issue || undefined, pr: pr.state === "OPEN" ? openPr(PR_INPUT, pr) : undefined };
  }
  const issue = required("ISSUE_NUMBER");
  const open = ghJson<{ number: number; body: string | null; headRefName: string }[]>([
    "pr", "list", "--repo", REPO, "--state", "open", "--search", `in:body "#${issue}"`,
    "--json", "number,body,headRefName",
  ]);
  const pr = open.find((p) => linkedIssueNumber(p.body) === issue);
  return { issue, pr: pr ? openPr(String(pr.number), pr) : undefined };
};

/** An open PR's mergeability and base, as GitHub reports them, with the PR they belong to. */
interface PrMergeability {
  readonly pr: string;
  readonly mergeable: Mergeability;
  readonly base: string;
}

/**
 * Undefined when the PR closed or merged as the handler waited:
 * `resolveTarget` saw it open before the wait, and nothing is handed off or
 * labeled on a PR that is no longer open.
 */
const mergeabilityOf = (pr: string): PrMergeability | undefined => {
  const view = ghJson<{ state: string; mergeable: Mergeability; baseRefName: string }>([
    "pr", "view", pr, "--repo", REPO, "--json", "state,mergeable,baseRefName",
  ]);
  return view.state === "OPEN" ? { pr, mergeable: view.mergeable, base: view.baseRefName } : undefined;
};

const labelsOf = (on: Subject): string[] =>
  ghJson<string[]>([on.kind, "view", on.number, "--repo", REPO, "--json", "labels", "--jq", "[.labels[].name]"]);

/** The newest run log the job wrote, tail only. */
const runLogTail = (): string => {
  const logsDir = path.join(outputDir(), "logs");
  if (!fs.existsSync(logsDir)) return "";
  const newest = fs
    .readdirSync(logsDir)
    .filter((name) => name.endsWith(".log"))
    .map((name) => ({ name, mtime: fs.statSync(path.join(logsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) return "";
  const lines = fs.readFileSync(path.join(logsDir, newest.name), "utf8").split("\n");
  return `Log tail (${newest.name}, last ${Math.min(LOG_TAIL_LINES, lines.length)} lines):\n${lines.slice(-LOG_TAIL_LINES).join("\n")}`;
};

interface Failure {
  readonly kind: FailureKind;
  readonly summary: string;
  readonly output: string;
  /** Why this is not the ticket's failure: requeue, do not count the attempt. */
  readonly requeue?: string;
  /** Why a retry cannot fix it; escalate at once. */
  readonly unretryable?: string;
  /** The open PR as the wait for checks last read it; undefined when it closed as the handler waited, or when no PR was read. */
  readonly mergeability?: PrMergeability;
}

const implementFailure = (outcome: string): Failure => {
  const reason = readIf(path.join(outputDir(), "failure_reason.txt"))?.trim() || missingFailureReason(outcome);
  return {
    kind: "implement",
    summary: `implement: ${reason.split("\n")[0]}`,
    output: [`Reason: ${reason}`, boundOutput(runLogTail(), LOG_LIMITS)].filter(Boolean).join("\n\n"),
    requeue: fs.existsSync(path.join(outputDir(), RATE_LIMITED_FILE)) ? RATE_LIMITED_REASON : undefined,
  };
};


/** The verdict this job just produced, as the reviewer wrote it. */
const verdictOutput = (): string => {
  const body = readIf(path.join(outputDir(), "pr_body.md")) ?? "";
  const start = body.indexOf(SECTION_START);
  const end = body.indexOf(SECTION_END);
  const section = start !== -1 && end !== -1 ? body.slice(start + SECTION_START.length, end).trim() : "";
  const summary = readIf(path.join(outputDir(), "summary.md"))?.trim() ?? "";
  return [section, summary].filter(Boolean).join("\n\n") || "(the verdict files were not found)";
};

/** The failed steps' log of another run, bounded. */
const failedLog = (url: string | null): string => {
  const runId = runIdFromUrl(url);
  if (!runId) return `(no run log: ${url ?? "no url"})`;
  try {
    const log = gh(["run", "view", runId, "--repo", REPO, "--log-failed"]);
    return boundOutput(log.trim() || "(the run has no failed step log)", LOG_LIMITS);
  } catch (error) {
    return `(could not read the log of run ${runId}: ${errorMessage(error)})`;
  }
};

const findFile = (dir: string, name: string): string | undefined => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
};

const mergeGateOutputs = new Map<string, string>();

/** The merge gate run's artifact (merge-gate.json plus the red-green logs), or its log when that fails. Both merge gate contexts share one run. */
const mergeGateOutput = async (url: string | null): Promise<string> => {
  const runId = runIdFromUrl(url);
  if (!runId) return `(no merge gate run: ${url ?? "no url"})`;
  const cached = mergeGateOutputs.get(runId);
  if (cached) return cached;
  const output = await readMergeGateArtifact(runId, url);
  mergeGateOutputs.set(runId, output);
  return output;
};

/** The artifact lands a few seconds after the statuses: try a few times. */
const downloadArtifacts = async (runId: string, dir: string): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      gh(["run", "download", runId, "--repo", REPO, "--dir", dir]);
      return;
    } catch (error) {
      if (attempt >= 6) throw error;
      console.log(`Artifact of run ${runId} not downloadable yet (try ${attempt}); waiting.`);
      await sleep(10_000);
    }
  }
};

const readMergeGateArtifact = async (runId: string, url: string | null): Promise<string> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-gate-artifact-"));
  try {
    await downloadArtifacts(runId, dir);
    const mergeGateFile = findFile(dir, "merge-gate.json");
    if (!mergeGateFile) return `(the merge gate run ${runId} uploaded no merge-gate.json)
${failedLog(url)}`;
    const next = (name: string) => readIf(path.join(path.dirname(mergeGateFile), name));
    const mergeGate = JSON.parse(fs.readFileSync(mergeGateFile, "utf8")) as MergeGateArtifact;
    return renderMergeGateOutput(mergeGate, { base: next("red-green-base.log"), head: next("red-green-head.log") });
  } catch (error) {
    return `(could not read the merge gate artifact of run ${runId}: ${errorMessage(error)})
${failedLog(url)}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const workflowNames = new Map<string, string | undefined>();
const workflowNameOf = (run: { html_url?: string | null }): string | undefined => {
  const runId = runIdFromUrl(run.html_url);
  if (!runId) return undefined;
  if (!workflowNames.has(runId)) {
    workflowNames.set(runId, tryGh(["api", `repos/${REPO}/actions/runs/${runId}`, "--jq", ".name"])?.trim());
  }
  return workflowNames.get(runId);
};

const headChecks = (sha: string) => {
  const statuses = ghJson<{ statuses: CommitStatus[] }>(["api", `repos/${REPO}/commits/${sha}/status`]).statuses;
  const runs = ghJson<{ check_runs: CheckRun[] }>([
    "api", `repos/${REPO}/commits/${sha}/check-runs?per_page=100`,
  ]).check_runs.map((run) => ({ ...run, workflowName: workflowNameOf(run) }));
  return evaluateChecks({ statuses, checkRuns: runs, own: { workflowName: WORKFLOW, runId: RUN_ID } });
};

const failureOutput = async (f: CheckFailure): Promise<string> => {
  const detail =
    f.kind === "verdict" ? verdictOutput() : f.kind === "merge-gate" ? await mergeGateOutput(f.url) : failedLog(f.url);
  return `## ${f.name}: ${f.kind} failure${f.description ? ` (${f.description})` : ""}\n${f.url ?? ""}\n\n${detail}`;
};

/**
 * Wait for the head's checks to settle, or for GitHub to report the open PR
 * conflicting (#145), then the failures among them. `waitOver` is the rule;
 * this is the clock and the reads.
 */
const checksFailure = async (pr: string | undefined): Promise<Failure | undefined> => {
  const sha = required("HEAD_SHA");
  const deadline = Date.now() + CHECKS_TIMEOUT_MS;
  // Mergeability is read only while a check is pending, the one state it can end or
  // decide: one gh call per such poll on top of the two check reads, and none on a
  // head that has settled, where a transient gh failure would block a PR for nothing.
  const observe = () => {
    const state = headChecks(sha);
    const mergeability = pr && state.pending.length > 0 ? mergeabilityOf(pr) : undefined;
    return { state, mergeability };
  };
  let seen = observe();
  while (!waitOver(seen.state, seen.mergeability?.mergeable) && Date.now() < deadline) {
    console.log(`Waiting for ${seen.state.pending.join(", ")} on ${sha.slice(0, 7)}.`);
    await sleep(POLL_MS);
    seen = observe();
  }
  const { state, mergeability } = seen;
  // Nothing failed, so there is no kind to name: `ci` is a placeholder the requeue path never reads.
  const stillPending = stillPendingReason(state, mergeability?.mergeable, CHECKS_TIMEOUT_MS / 60_000);
  if (stillPending) return { kind: "ci", summary: stillPending, output: "", requeue: stillPending, mergeability };
  const { failures } = state;
  if (failures.length === 0) return undefined;
  const parts: string[] = [];
  for (const f of failures) parts.push(await failureOutput(f));
  const first = failures[0] as CheckFailure;
  return {
    kind: first.kind,
    summary: summariseFailures(failures),
    output: parts.join("\n\n"),
    unretryable: unretryableReason(failures),
  };
};

const artifactUrl = (): string | undefined => {
  if (!ARTIFACT_NAME || !RUN_ID) return undefined;
  const id = tryGh([
    "api", `repos/${REPO}/actions/runs/${RUN_ID}/artifacts`, "--jq",
    `.artifacts[] | select(.name == "${ARTIFACT_NAME}") | .id`,
  ])?.trim();
  return id ? `https://github.com/${REPO}/actions/runs/${RUN_ID}/artifacts/${id}` : undefined;
};

const branchExists = (): boolean =>
  tryGh(["api", `repos/${REPO}/branches/${BRANCH}`, "--jq", ".name"]) !== undefined;

const ensureRetryLabel = (label: string): void => {
  tryWrite(["label", "create", label, "--repo", REPO, "--color", "c5def5", "--description", "Factory: retries used on this ticket", "--force"]);
};

const commentOn = (on: Subject, body: string): void => {
  const file = path.join(outputDir(), `retry-comment-${on.kind}-${on.number}.md`);
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(file, body);
  ghWrite([on.kind, "comment", on.number, "--repo", REPO, "--body-file", file]);
};

const retry = (target: Target, retryNumber: number, failure: Failure): void => {
  const label = retryLabel(retryNumber);
  const comment = renderRetryComment({ retry: retryNumber, kind: failure.kind, runUrl: RUN_URL, output: failure.output });
  const on = recordOn(target);
  commentOn(on, comment);
  ensureRetryLabel(label);
  ghWrite([on.kind, "edit", on.number, "--repo", REPO, "--add-label", label]);
  // The label that starts the retry goes last, once the context it reads is in place.
  const trigger = actOn(target);
  ghWrite([trigger.kind, "edit", trigger.number, "--repo", REPO, "--add-label", IMPLEMENT_LABEL]);
  console.log(
    `Retry ${retryNumber} of ${MAX_RETRIES}: ${label} on ${on.kind} #${on.number}, ${IMPLEMENT_LABEL} on ${trigger.kind} #${trigger.number} (${failure.summary}).`,
  );
};

/**
 * What a requeued PR is left in: `agent:in-progress`, the label the
 * reconciler sweeps, so it re-adds the start label at its stuck deadline
 * (#148). Two halves, because the workflows take that label off on both sides
 * of this handler. implement-pr's retry job drops it a step before the handler
 * runs, so the label is added back here; agent-review.yml drops it on its way
 * out afterwards, so the marker file tells that step to leave it alone. Either
 * way the PR is never left with no `agent:*` label, which nothing sweeps.
 *
 * A requeued ticket gets neither: no factory label is exactly what the
 * dispatcher picks up on its next sweep.
 *
 * The label goes on with `ghWrite`, not `tryWrite`, and the marker is written
 * only once it is on. A swallowed failure here is the one outcome this
 * function exists to prevent: implement-pr's retry job has already dropped
 * the label, so a PR whose re-add failed would be left with no `agent:*`
 * label at all and the handler would still exit 0. Throwing instead hands the
 * PR to the workflow's own fallback, which adds `agent:blocked`, and the
 * absent marker lets agent-review.yml's last step clean up as it always did.
 */
const keepInProgress = (pr: string, reason: string): void => {
  ghWrite(["pr", "edit", pr, "--repo", REPO, "--add-label", IN_PROGRESS_LABEL]);
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(path.join(outputDir(), REQUEUED_FILE), `${reason}\n`);
};

const requeue = (target: Target, reason: string): void => {
  const on = actOn(target);
  const onPr = on.kind === "pr";
  commentOn(on, renderRequeueComment({ reason, runUrl: RUN_URL, onPr }));
  if (onPr) keepInProgress(on.number, reason);
  console.log(
    `Requeued ${on.kind} #${on.number} without spending a retry: ${reason}` +
      (onPr
        ? `; left in ${IN_PROGRESS_LABEL}, the reconciler re-adds the start label at its stuck deadline.`
        : "; the dispatcher re-dispatches it."),
  );
};

/** The conflict hand-off update-branch makes, from here: a comment naming the cause, then the implementer's label. No retry label. */
const handOff = ({ pr, base }: PrMergeability, reason: string): void => {
  commentOn({ kind: "pr", number: pr }, renderHandOffComment({ reason, base, runUrl: RUN_URL }));
  ghWrite(["pr", "edit", pr, "--repo", REPO, "--add-label", IMPLEMENT_LABEL]);
  console.log(`Handed off PR #${pr} without spending a retry: ${reason}; ${IMPLEMENT_LABEL} on.`);
};

const escalate = (target: Target, reason: string, failure: Failure): void => {
  const openPr = target.pr;
  let escalatedPr: EscalatedPr | undefined;
  if (openPr) {
    const { remove, add, close } = prEscalation({
      ...openPr.facts,
      labels: labelsOf({ kind: "pr", number: openPr.number }),
    });
    if (remove.length > 0) tryWrite(["pr", "edit", openPr.number, "--repo", REPO, "--remove-label", remove.join(",")]);
    if (add) tryWrite(["pr", "edit", openPr.number, "--repo", REPO, "--add-label", add]);
    if (close) {
      tryWrite([
        "pr", "close", openPr.number, "--repo", REPO, "--comment",
        `Closed by the factory: ${reason}. The branch is kept; see ${target.issue ? `#${target.issue}` : "the run"} for the escalation. Run: ${RUN_URL}`,
      ]);
    } else {
      // Closing cancels auto-merge; leaving the PR open does not. The factory
      // arms auto-merge on every PR it reads as its own, this one included, so
      // a PR it has just declared itself done with would otherwise still hold a
      // standing instruction to merge the moment its checks go green. Disarming
      // it is the same "stand down" the labels are. Refused when none was armed,
      // which `tryWrite` swallows.
      tryWrite(["pr", "merge", openPr.number, "--repo", REPO, "--disable-auto"]);
    }
    escalatedPr = { number: openPr.number, closed: close };
  }
  const on = recordOn(target);
  const labels = escalationLabels(labelsOf(on));
  if (labels.remove.length > 0) tryWrite([on.kind, "edit", on.number, "--repo", REPO, "--remove-label", labels.remove.join(",")]);
  ghWrite([on.kind, "edit", on.number, "--repo", REPO, "--add-label", labels.add]);
  commentOn(
    on,
    renderEscalationComment({
      // The PR's own number when no ticket was found, which is the reachable
      // case for a PR the factory did not author: it closes no ticket. The
      // comment renders it as `#N`, which on that PR's thread links to itself.
      issueNumber: target.issue ?? (target.pr as OpenPr).number,
      reason,
      summary: failure.summary,
      runUrl: RUN_URL,
      logUrl: artifactUrl(),
      branch: BRANCH,
      branchExists: branchExists(),
      pr: escalatedPr,
      output: failure.output,
    }),
  );
  // Last, and with `tryWrite` rather than `commentOn`, which throws: the record
  // above is the thing that must not be lost. A PR left open whose courtesy
  // note fails is a human short one comment; the same failure ahead of the
  // record would cost the escalation its label and its comment, which is the
  // silent drop #174 asks to prevent. Only when the record went elsewhere,
  // since with no ticket `recordOn` is this PR and it was just commented on.
  if (escalatedPr && !escalatedPr.closed && on.kind !== "pr") {
    tryWrite([
      "pr", "comment", escalatedPr.number, "--repo", REPO, "--body",
      renderLeftOpenPrComment({ reason, issueNumber: on.number, runUrl: RUN_URL }),
    ]);
  }
  const prNote = !escalatedPr
    ? ""
    : escalatedPr.closed
      ? `, PR #${escalatedPr.number} closed`
      : `, PR #${escalatedPr.number} left open (the factory did not author it)`;
  console.log(`Escalated ${on.kind} #${on.number}: ${labels.add} on, ${labels.remove.join(", ") || "no factory labels"} off${prNote}.`);
};

const main = async (): Promise<void> => {
  let target = resolveTarget();
  console.log(`Ticket #${target.issue ?? "(none)"}, open PR #${target.pr?.number ?? "(none)"}, branch ${BRANCH}.`);

  let failure: Failure | undefined;
  if (FAILURE_KIND === "implement") {
    const outcome = process.env.IMPLEMENTER_OUTCOME ?? "";
    if (!isImplementerFailure(outcome)) {
      console.log(
        `The implementer ended '${outcome || "(it never started)"}', so the failure is not the implementer's own: no retry is spent.`,
      );
      process.exit(1);
    }
    failure = implementFailure(outcome);
  } else if (FAILURE_KIND === "checks") {
    failure = await checksFailure(target.pr?.number);
  } else {
    throw new Error(`FAILURE_KIND must be implement or checks, got ${FAILURE_KIND}`);
  }
  if (!failure) {
    console.log("Every check on the head passed; nothing to retry.");
    return;
  }

  // Only the checks wait can end in a hand-off, and only an open PR can conflict: the
  // wait's last read is used and nothing is read again (#145). A rate limit's requeue
  // never waited for the head, so its PR is requeued whatever its mergeability; the
  // conflict is the checks path's fact (#144). The same read is where a PR that closed
  // or merged as the handler waited drops out, so the requeue falls back to the ticket
  // instead of labeling a PR nobody keeps.
  const mergeability = failure.mergeability;
  if (FAILURE_KIND === "checks" && failure.requeue && target.pr) {
    if (!mergeability) {
      console.log(`PR #${target.pr.number} closed or merged as the handler waited; it is no longer the subject.`);
      target = { ...target, pr: undefined };
      if (!target.issue) {
        console.log("No ticket to fall back to; nothing to requeue.");
        return;
      }
    }
  }
  const labels = labelsOf(recordOn(target));
  const used = retriesUsed(labels);
  const decision = decide({
    retriesUsed: used,
    kind: failure.kind,
    escalated: labels.includes(ESCALATION_LABEL),
    requeue: failure.requeue,
    mergeable: mergeability?.mergeable,
    unretryable: failure.unretryable,
  });
  console.log(`${failure.summary}. Retries used: ${used}. Decision: ${decision.action}${"reason" in decision ? ` (${decision.reason})` : ""}.`);

  if (decision.action === "retry") retry(target, decision.retry, failure);
  else if (decision.action === "escalate") escalate(target, decision.reason, failure);
  else if (decision.action === "requeue") requeue(target, decision.reason);
  else if (decision.action === "hand-off") {
    // decide answers hand-off only from a mergeability it was given, and one is given only from a read.
    if (!mergeability) throw new Error("hand-off decided without a mergeability read");
    handOff(mergeability, decision.reason);
  }
};

main().catch((error) => {
  console.error(`Retry handler failed: ${errorMessage(error)}`);
  process.exit(1);
});
