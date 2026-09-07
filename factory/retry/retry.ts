/**
 * The failure handler the workflows run when an attempt fails (#16). Reads
 * the ticket's retry count, decides with `decide.ts`, and acts:
 *
 * - retry: post the failing output as a marker comment on the ticket, add
 *   `factory:retry-<n>`, and label `agent:implement` (on the PR when one is
 *   open, so implement-pr runs on the branch; on the ticket otherwise).
 * - escalate: agent:* labels off, needs-human on, the draft PR closed, the
 *   branch kept, a comment on the ticket linking the run and its log.
 *
 * Runs with FACTORY_PAT so the labels it adds fire events.
 *
 * Env: GH_REPO, GH_TOKEN, BRANCH, RUN_URL, OUTPUT_DIR, one of ISSUE_NUMBER
 * or PR_NUMBER, and FAILURE_KIND:
 * - `implement`: the run in this job failed; the output is
 *   OUTPUT_DIR/failure_reason.txt plus the tail of the newest run log.
 * - `checks`: a verdict was just posted on HEAD_SHA; wait for the head's
 *   other checks to settle (CHECKS_TIMEOUT_MINUTES, default 15), then fail
 *   on any failing status or check run. No failure means nothing to do.
 * Optional: ARTIFACT_NAME for the log link, GITHUB_RUN_ID and
 * GITHUB_WORKFLOW (set by the runner) to ignore the factory's own check runs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { gh, outputDir, required, writeJson } from "../shared/common";
import { SECTION_END, SECTION_START, boundOutput } from "../shared/verdict";
import {
  type CheckFailure,
  type CheckRun,
  type CommitStatus,
  evaluateChecks,
  runIdFromUrl,
  summariseFailures,
} from "./checks";
import {
  decide,
  ESCALATION_LABEL,
  escalationLabels,
  type FailureKind,
  renderEscalationComment,
  renderRetryComment,
  retriesUsed,
  retryLabel,
} from "./decide";

const REPO = required("GH_REPO");
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
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/i;

const readIf = (file: string): string | undefined =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ghJson = <T>(args: string[]): T => JSON.parse(gh(args)) as T;

const tryGh = (args: string[]): string | undefined => {
  try {
    return gh(args);
  } catch (error) {
    console.log(`gh ${args.slice(0, 3).join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

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
    const issue = ISSUE_INPUT ?? (pr.body ?? "").match(CLOSES)?.[1];
    return { issue, pr: pr.state === "OPEN" ? PR_INPUT : undefined };
  }
  const issue = required("ISSUE_NUMBER");
  const open = ghJson<{ number: number; body: string | null }[]>([
    "pr", "list", "--repo", REPO, "--state", "open", "--search", `in:body "#${issue}"`, "--json", "number,body",
  ]);
  const pr = open.find((p) => (p.body ?? "").match(CLOSES)?.[1] === issue);
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
}

const implementFailure = (): Failure => {
  const reason = readIf(path.join(outputDir(), "failure_reason.txt"))?.trim() || "(no reason file written; see the workflow log)";
  return {
    kind: "implement",
    summary: `implement: ${reason.split("\n")[0]}`,
    output: [`Reason: ${reason}`, boundOutput(runLogTail(), LOG_LIMITS)].filter(Boolean).join("\n\n"),
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
    const log = execFileSync("gh", ["run", "view", runId, "--repo", REPO, "--log-failed"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return boundOutput(log.trim() || "(the run has no failed step log)", LOG_LIMITS);
  } catch (error) {
    return `(could not read the log of run ${runId}: ${error instanceof Error ? error.message : String(error)})`;
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

/** Wait for the head's checks to settle, then the failures among them. */
const checksFailure = async (): Promise<{ failures: CheckFailure[]; failure: Failure | undefined }> => {
  const sha = required("HEAD_SHA");
  const deadline = Date.now() + CHECKS_TIMEOUT_MS;
  let state = headChecks(sha);
  while (state.pending.length > 0 && Date.now() < deadline) {
    console.log(`Waiting for ${state.pending.join(", ")} on ${sha.slice(0, 7)}.`);
    await sleep(POLL_MS);
    state = headChecks(sha);
  }
  if (state.pending.length > 0) {
    console.log(`Still pending after the wait, judged as not failed: ${state.pending.join(", ")}.`);
  }
  if (state.failures.length === 0) return { failures: [], failure: undefined };
  const output = state.failures
    .map((f) => `## ${f.name}: ${f.kind} failure${f.description ? ` (${f.description})` : ""}\n${f.url ?? ""}\n\n${f.kind === "verdict" ? verdictOutput() : failedLog(f.url)}`)
    .join("\n\n");
  const first = state.failures[0] as CheckFailure;
  return {
    failures: state.failures,
    failure: { kind: first.kind, summary: summariseFailures(state.failures), output },
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
  tryGh(["label", "create", label, "--repo", REPO, "--color", "c5def5", "--description", "Factory: retries used on this ticket", "--force"]);
};

const commentOn = (kind: "issue" | "pr", number: string, body: string): void => {
  const file = path.join(outputDir(), `retry-comment-${kind}-${number}.md`);
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(file, body);
  gh([kind, "comment", number, "--repo", REPO, "--body-file", file]);
};

const retry = (target: Target, attempt: number, failure: Failure): void => {
  const label = retryLabel(attempt - 1);
  const comment = renderRetryComment({ attempt, kind: failure.kind, runUrl: RUN_URL, output: failure.output });
  const on: ["issue" | "pr", string] = target.issue ? ["issue", target.issue] : ["pr", target.pr as string];
  commentOn(on[0], on[1], comment);
  ensureRetryLabel(label);
  gh([on[0], "edit", on[1], "--repo", REPO, "--add-label", label]);
  // The label that starts the retry goes last, once the context it reads is in place.
  const trigger: ["issue" | "pr", string] = target.pr ? ["pr", target.pr] : ["issue", target.issue as string];
  gh([trigger[0], "edit", trigger[1], "--repo", REPO, "--add-label", IMPLEMENT_LABEL]);
  console.log(
    `Retry ${attempt - 1} of ${attempt - 1}: ${label} on ${on[0]} #${on[1]}, ${IMPLEMENT_LABEL} on ${trigger[0]} #${trigger[1]} (${failure.summary}).`,
  );
};

const escalate = (target: Target, reason: string, failure: Failure): void => {
  if (target.pr) {
    const prLabels = escalationLabels(labelsOf("pr", target.pr)).remove;
    if (prLabels.length > 0) tryGh(["pr", "edit", target.pr, "--repo", REPO, "--remove-label", prLabels.join(",")]);
    tryGh([
      "pr", "close", target.pr, "--repo", REPO, "--comment",
      `Closed by the factory: ${reason}. The branch is kept; see ${target.issue ? `#${target.issue}` : "the run"} for the escalation. Run: ${RUN_URL}`,
    ]);
  }
  const on: ["issue" | "pr", string] = target.issue ? ["issue", target.issue] : ["pr", target.pr as string];
  const labels = escalationLabels(labelsOf(on[0], on[1]));
  if (labels.remove.length > 0) tryGh([on[0], "edit", on[1], "--repo", REPO, "--remove-label", labels.remove.join(",")]);
  gh([on[0], "edit", on[1], "--repo", REPO, "--add-label", labels.add]);
  commentOn(
    on[0],
    on[1],
    renderEscalationComment({
      issueNumber: target.issue ?? `PR ${target.pr}`,
      kind: failure.kind,
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
  let checkFailures: CheckFailure[] = [];
  if (FAILURE_MODE === "implement") {
    failure = implementFailure();
  } else if (FAILURE_MODE === "checks") {
    ({ failures: checkFailures, failure } = await checksFailure());
  } else {
    throw new Error(`FAILURE_KIND must be implement or checks, got ${FAILURE_MODE}`);
  }
  if (!failure) {
    console.log("Every check on the head passed; nothing to retry.");
    writeJson("retry.json", { action: "none", reason: "all checks passed", target });
    return;
  }

  const labels = target.issue ? labelsOf("issue", target.issue) : labelsOf("pr", target.pr as string);
  const used = retriesUsed(labels);
  const decision = decide({ retriesUsed: used, kind: failure.kind, escalated: labels.includes(ESCALATION_LABEL) });
  console.log(`Failure: ${failure.summary}. Retries used: ${used}. Decision: ${decision.action}${"reason" in decision ? ` (${decision.reason})` : ""}.`);

  if (decision.action === "retry") retry(target, decision.attempt, failure);
  else if (decision.action === "escalate") escalate(target, decision.reason, failure);

  writeJson("retry.json", {
    ...decision,
    target,
    retriesUsed: used,
    kind: failure.kind,
    summary: failure.summary,
    failures: checkFailures.map(({ name, kind, description, url }) => ({ name, kind, description, url })),
  });
};

main().catch((error) => {
  console.error(`Retry handler failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
