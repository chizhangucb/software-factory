/**
 * The failure handler the workflows run when an attempt fails (#16). Reads
 * the ticket's retry count, decides with `decide.ts`, and acts:
 *
 * - retry: post the failing output as a marker comment on the ticket, add
 *   `factory:retry-<n>`, and label `agent:implement` (on the PR when one is
 *   open, so implement-pr runs on the branch; on the ticket otherwise).
 * - escalate: agent:* labels off, needs-human on, the PR closed, the
 *   branch kept, a comment on the ticket linking the run and its log.
 * - requeue (rate limited on every account, #17): no retry spent. A ticket
 *   gets a comment and is left for the dispatcher; a PR gets the comment
 *   and `agent:blocked`, since nothing re-dispatches a PR.
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
 *   failed or was killed spends a retry; anything else exits 1 so the calling
 *   job posts its blocked comment (#51).
 * - `checks`: a verdict was just posted on HEAD_SHA; wait for the head's
 *   other checks to settle (CHECKS_TIMEOUT_MINUTES, default 15), then fail
 *   on any failing status or check run. A check still pending at the
 *   deadline is a failure too, so a PR never sits unjudged. No failure
 *   means nothing to do.
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
  type GateArtifact,
  renderGateOutput,
  runIdFromUrl,
  summariseFailures,
  unretryableReason,
} from "./checks";
import {
  decide,
  ESCALATION_LABEL,
  escalationLabels,
  type FailureKind,
  isImplementerFailure,
  MAX_RETRIES,
  missingFailureReason,
  renderEscalationComment,
  renderRequeueComment,
  renderRetryComment,
  retriesUsed,
  retryLabel,
} from "./decide";

const REPO = required("GH_REPO");
const FACTORY_PAT = required("FACTORY_PAT");
const BRANCH = required("BRANCH");
const RUN_URL = required("RUN_URL");
const FAILURE_MODE = required("FAILURE_KIND");
const ISSUE_INPUT = process.env.ISSUE_NUMBER || undefined;
const PR_INPUT = process.env.PR_NUMBER || undefined;
const RUN_ID = process.env.GITHUB_RUN_ID ?? "";
const WORKFLOW = process.env.GITHUB_WORKFLOW ?? "";
const ARTIFACT_NAME = process.env.ARTIFACT_NAME;
const CHECKS_TIMEOUT_MS = Number(process.env.CHECKS_TIMEOUT_MINUTES || 15) * 60_000;
const POLL_MS = 20_000;

const LOG_TAIL_LINES = 120;
const LOG_LIMITS = { head: 2_000, tail: 8_000 };

const IMPLEMENT_LABEL = "agent:implement";
const BLOCKED_LABEL = "agent:blocked";

const readIf = (file: string): string | undefined =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ghJson = <T>(args: string[]): T => JSON.parse(gh(args)) as T;

/** A write with FACTORY_PAT: labels it adds fire events, GITHUB_TOKEN's do not. */
const ghWrite = (args: string[]): string =>
  gh(args, { ...process.env, GH_TOKEN: FACTORY_PAT, GITHUB_TOKEN: FACTORY_PAT });

const attempt = (call: () => string, label: string): string | undefined => {
  try {
    return call();
  } catch (error) {
    console.log(`${label} failed: ${errorMessage(error)}`);
    return undefined;
  }
};
const tryGh = (args: string[]): string | undefined => attempt(() => gh(args), `gh ${args.slice(0, 3).join(" ")}`);
const tryWrite = (args: string[]): string | undefined => attempt(() => ghWrite(args), `gh ${args.slice(0, 3).join(" ")}`);

interface Target {
  readonly issue: string | undefined;
  /** An open PR for the branch, when there is one. */
  readonly pr: string | undefined;
}

/** The ticket and its open PR from whichever number the workflow knows. */
const resolveTarget = (): Target => {
  if (PR_INPUT) {
    const pr = ghJson<{ state: string; body: string | null }>([
      "pr", "view", PR_INPUT, "--repo", REPO, "--json", "state,body",
    ]);
    const issue = ISSUE_INPUT ?? linkedIssueNumber(pr.body) ?? undefined;
    return { issue: issue || undefined, pr: pr.state === "OPEN" ? PR_INPUT : undefined };
  }
  const issue = required("ISSUE_NUMBER");
  const open = ghJson<{ number: number; body: string | null }[]>([
    "pr", "list", "--repo", REPO, "--state", "open", "--search", `in:body "#${issue}"`, "--json", "number,body",
  ]);
  const pr = open.find((p) => linkedIssueNumber(p.body) === issue);
  return { issue, pr: pr ? String(pr.number) : undefined };
};

const labelsOf = (kind: "issue" | "pr", number: string): string[] =>
  ghJson<string[]>([kind, "view", number, "--repo", REPO, "--json", "labels", "--jq", "[.labels[].name]"]);

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
  /** Every account was rate limited: requeue, do not count the attempt. */
  readonly rateLimited?: boolean;
  /** Why a retry cannot fix it; escalate at once. */
  readonly unretryable?: string;
}

const implementFailure = (outcome: string): Failure => {
  const reason = readIf(path.join(outputDir(), "failure_reason.txt"))?.trim() || missingFailureReason(outcome);
  return {
    kind: "implement",
    summary: `implement: ${reason.split("\n")[0]}`,
    output: [`Reason: ${reason}`, boundOutput(runLogTail(), LOG_LIMITS)].filter(Boolean).join("\n\n"),
    rateLimited: fs.existsSync(path.join(outputDir(), RATE_LIMITED_FILE)),
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

const gateOutputs = new Map<string, string>();

/** The gate run's artifact (gate.json plus the red-green logs), or its log when that fails. Both gate contexts share one run. */
const gateOutput = async (url: string | null): Promise<string> => {
  const runId = runIdFromUrl(url);
  if (!runId) return `(no gate run: ${url ?? "no url"})`;
  const cached = gateOutputs.get(runId);
  if (cached) return cached;
  const output = await readGateArtifact(runId, url);
  gateOutputs.set(runId, output);
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

const readGateArtifact = async (runId: string, url: string | null): Promise<string> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-artifact-"));
  try {
    await downloadArtifacts(runId, dir);
    const gateFile = findFile(dir, "gate.json");
    if (!gateFile) return `(the gate run ${runId} uploaded no gate.json)
${failedLog(url)}`;
    const next = (name: string) => readIf(path.join(path.dirname(gateFile), name));
    const gate = JSON.parse(fs.readFileSync(gateFile, "utf8")) as GateArtifact;
    return renderGateOutput(gate, { base: next("red-green-base.log"), head: next("red-green-head.log") });
  } catch (error) {
    return `(could not read the gate artifact of run ${runId}: ${errorMessage(error)})
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
    f.kind === "verdict" ? verdictOutput() : f.kind === "gate" ? await gateOutput(f.url) : failedLog(f.url);
  return `## ${f.name}: ${f.kind} failure${f.description ? ` (${f.description})` : ""}\n${f.url ?? ""}\n\n${detail}`;
};

/** Wait for the head's checks to settle, then the failures among them. */
const checksFailure = async (): Promise<Failure | undefined> => {
  const sha = required("HEAD_SHA");
  const deadline = Date.now() + CHECKS_TIMEOUT_MS;
  let state = headChecks(sha);
  while (state.pending.length > 0 && Date.now() < deadline) {
    console.log(`Waiting for ${state.pending.join(", ")} on ${sha.slice(0, 7)}.`);
    await sleep(POLL_MS);
    state = headChecks(sha);
  }
  const failures: CheckFailure[] = [
    ...state.failures,
    ...state.pending.map((name) => ({
      name,
      kind: "ci" as const,
      description: `not finished after ${CHECKS_TIMEOUT_MS / 60_000} minutes`,
      url: null,
    })),
  ];
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

const commentOn = (kind: "issue" | "pr", number: string, body: string): void => {
  const file = path.join(outputDir(), `retry-comment-${kind}-${number}.md`);
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(file, body);
  ghWrite([kind, "comment", number, "--repo", REPO, "--body-file", file]);
};

const retry = (target: Target, retryNumber: number, failure: Failure): void => {
  const label = retryLabel(retryNumber);
  const comment = renderRetryComment({ retry: retryNumber, kind: failure.kind, runUrl: RUN_URL, output: failure.output });
  const on: ["issue" | "pr", string] = target.issue ? ["issue", target.issue] : ["pr", target.pr as string];
  commentOn(on[0], on[1], comment);
  ensureRetryLabel(label);
  ghWrite([on[0], "edit", on[1], "--repo", REPO, "--add-label", label]);
  // The label that starts the retry goes last, once the context it reads is in place.
  const trigger: ["issue" | "pr", string] = target.pr ? ["pr", target.pr] : ["issue", target.issue as string];
  ghWrite([trigger[0], "edit", trigger[1], "--repo", REPO, "--add-label", IMPLEMENT_LABEL]);
  console.log(
    `Retry ${retryNumber} of ${MAX_RETRIES}: ${label} on ${on[0]} #${on[1]}, ${IMPLEMENT_LABEL} on ${trigger[0]} #${trigger[1]} (${failure.summary}).`,
  );
};

const requeue = (target: Target, reason: string): void => {
  const on: ["issue" | "pr", string] = target.pr ? ["pr", target.pr] : ["issue", target.issue as string];
  const onPr = on[0] === "pr";
  commentOn(on[0], on[1], renderRequeueComment({ reason, runUrl: RUN_URL, onPr }));
  if (onPr) ghWrite(["pr", "edit", on[1], "--repo", REPO, "--add-label", BLOCKED_LABEL]);
  console.log(
    `Requeued ${on[0]} #${on[1]} without spending a retry: ${reason}` +
      (onPr ? `; ${BLOCKED_LABEL} on, a human re-adds ${IMPLEMENT_LABEL}.` : "; the dispatcher re-dispatches it."),
  );
};

const escalate = (target: Target, reason: string, failure: Failure): void => {
  if (target.pr) {
    const prLabels = escalationLabels(labelsOf("pr", target.pr)).remove;
    if (prLabels.length > 0) tryWrite(["pr", "edit", target.pr, "--repo", REPO, "--remove-label", prLabels.join(",")]);
    tryWrite([
      "pr", "close", target.pr, "--repo", REPO, "--comment",
      `Closed by the factory: ${reason}. The branch is kept; see ${target.issue ? `#${target.issue}` : "the run"} for the escalation. Run: ${RUN_URL}`,
    ]);
  }
  const on: ["issue" | "pr", string] = target.issue ? ["issue", target.issue] : ["pr", target.pr as string];
  const labels = escalationLabels(labelsOf(on[0], on[1]));
  if (labels.remove.length > 0) tryWrite([on[0], "edit", on[1], "--repo", REPO, "--remove-label", labels.remove.join(",")]);
  ghWrite([on[0], "edit", on[1], "--repo", REPO, "--add-label", labels.add]);
  commentOn(
    on[0],
    on[1],
    renderEscalationComment({
      issueNumber: target.issue ?? `PR ${target.pr}`,
      reason,
      summary: failure.summary,
      runUrl: RUN_URL,
      logUrl: artifactUrl(),
      branch: BRANCH,
      branchExists: branchExists(),
      closedPr: target.pr,
      output: failure.output,
    }),
  );
  console.log(`Escalated ${on[0]} #${on[1]}: ${labels.add} on, ${labels.remove.join(", ") || "no agent labels"} off${target.pr ? `, PR #${target.pr} closed` : ""}.`);
};

const main = async (): Promise<void> => {
  const target = resolveTarget();
  console.log(`Ticket #${target.issue ?? "(none)"}, open PR #${target.pr ?? "(none)"}, branch ${BRANCH}.`);

  let failure: Failure | undefined;
  if (FAILURE_MODE === "implement") {
    const outcome = required("IMPLEMENTER_OUTCOME");
    if (!isImplementerFailure(outcome)) {
      console.log(
        `The implementer ended '${outcome}', so the failure is not the implementer's own: no retry is spent.`,
      );
      process.exit(1);
    }
    failure = implementFailure(outcome);
  } else if (FAILURE_MODE === "checks") {
    failure = await checksFailure();
  } else {
    throw new Error(`FAILURE_KIND must be implement or checks, got ${FAILURE_MODE}`);
  }
  if (!failure) {
    console.log("Every check on the head passed; nothing to retry.");
    return;
  }

  const labels = target.issue ? labelsOf("issue", target.issue) : labelsOf("pr", target.pr as string);
  const used = retriesUsed(labels);
  const decision = decide({
    retriesUsed: used,
    kind: failure.kind,
    escalated: labels.includes(ESCALATION_LABEL),
    rateLimited: failure.rateLimited,
    unretryable: failure.unretryable,
  });
  console.log(`Failure: ${failure.summary}. Retries used: ${used}. Decision: ${decision.action}${"reason" in decision ? ` (${decision.reason})` : ""}.`);

  if (decision.action === "retry") retry(target, decision.retry, failure);
  else if (decision.action === "escalate") escalate(target, decision.reason, failure);
  else if (decision.action === "requeue") requeue(target, decision.reason);
};

main().catch((error) => {
  console.error(`Retry handler failed: ${errorMessage(error)}`);
  process.exit(1);
});
