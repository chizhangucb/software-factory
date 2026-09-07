/**
 * Sweep (#35): build the reconciler's snapshot from the target repo, decide
 * with `reconcile.ts`, apply the repairs, log one line per decision.
 *
 * Runs after the dispatcher on the schedule, on workflow_dispatch, and on
 * the `factory-sweep` repository_dispatch (the external trigger for when
 * GitHub's cron does not fire). Reads that a fine-grained PAT cannot make
 * (Actions runs and jobs, commit statuses) use READ_TOKEN; every write uses
 * GH_TOKEN so the labels fire their events.
 *
 * Env: GH_REPO (owner/repo), GH_TOKEN (FACTORY_PAT), READ_TOKEN
 * (GITHUB_TOKEN; defaults to GH_TOKEN), optional BASE_BRANCH (main),
 * STUCK_MINUTES, VERDICT_MINUTES, UPDATE_MINUTES (see DEFAULT_DEADLINES),
 * RUN_URL, OUTPUT_DIR for sweep.json, DRY_RUN=1 to decide without writing.
 *
 * Builtins only, imported with `.ts` extensions, so the job runs on bare
 * `node --experimental-strip-types` and skips installing the engine.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_DEADLINES,
  type Deadlines,
  type Decision,
  type PrState,
  type Run,
  type Snapshot,
  type TicketState,
  type VerdictState,
  PARKED_LABELS,
  marksFromTimeline,
  prFromGitHub,
  reconcile,
  roleFromJobs,
  runFromGitHub,
  runsFor,
  stateSinceFromTimeline,
  ticketFromGitHub,
} from "./reconcile.ts";

const repo = process.env.GH_REPO;
if (!repo) {
  console.error("Missing required env var: GH_REPO");
  process.exit(1);
}
const base = process.env.BASE_BRANCH || "main";
const dryRun = process.env.DRY_RUN === "1";
const runUrl = process.env.RUN_URL;
const readEnv = { ...process.env, GH_TOKEN: process.env.READ_TOKEN || process.env.GH_TOKEN };

const gh = (args: string[], env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
const ghJson = (args: string[], env?: NodeJS.ProcessEnv): any => JSON.parse(gh(args, env));
const paginate = (endpoint: string, env?: NodeJS.ProcessEnv): any[] =>
  ghJson(["api", "--paginate", "--slurp", endpoint], env).flat();

const minutesInput = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  console.log(`::warning::${name} must be a positive integer, got '${raw}'; using ${fallback}.`);
  return fallback;
};

const deadlines: Deadlines = {
  stuckMinutes: minutesInput("STUCK_MINUTES", DEFAULT_DEADLINES.stuckMinutes),
  verdictMinutes: minutesInput("VERDICT_MINUTES", DEFAULT_DEADLINES.verdictMinutes),
  updateMinutes: minutesInput("UPDATE_MINUTES", DEFAULT_DEADLINES.updateMinutes),
};

const now = new Date();
const parked = (labels: readonly string[]): boolean => PARKED_LABELS.some((l) => labels.includes(l));

/* Snapshot: issues and PRs with their label times and sweep marks. */

const timeline = (number: number): any[] => paginate(`repos/${repo}/issues/${number}/timeline?per_page=100`);

const withLabelState = <T extends TicketState | PrState>(subject: T, stateLabels: readonly string[]): T => {
  const state = stateLabels.find((l) => subject.labels.includes(l));
  if (!state || parked(subject.labels)) return subject;
  const events = timeline(subject.number);
  return { ...subject, stateSince: stateSinceFromTimeline(events, state), marks: marksFromTimeline(events) };
};

const issues: TicketState[] = paginate(`repos/${repo}/issues?state=open&per_page=100`)
  .filter((raw: any) => !raw.pull_request)
  .map(ticketFromGitHub)
  .map((t) => withLabelState(t, ["agent:in-progress", "agent:implement"]));

const verdictOn = (sha: string): VerdictState => {
  const statuses: { context: string; state: string }[] = ghJson(["api", `repos/${repo}/commits/${sha}/status`, "--jq", ".statuses"], readEnv);
  const state = statuses.find((s) => s.context === "factory/verdict")?.state;
  return state === "pending" || state === "success" || state === "failure" || state === "error" ? state : "none";
};

const later = (a: string, b: string): string => (Date.parse(a) >= Date.parse(b) ? a : b);

const withMergeState = (pr: PrState, createdAt: string): PrState => {
  if (!pr.autoMerge || !pr.factory || pr.labels.some((l) => l.startsWith("agent:")) || parked(pr.labels)) return pr;
  const verdict = verdictOn(pr.headSha);
  if (verdict === "none") {
    const committed = gh(["api", `repos/${repo}/commits/${pr.headSha}`, "--jq", ".commit.committer.date"]).trim();
    return { ...pr, verdict, headSince: later(createdAt, committed || createdAt) };
  }
  if (verdict !== "success") return { ...pr, verdict };
  const behindBy = Number(gh(["api", `repos/${repo}/compare/${base}...${pr.headSha}`, "--jq", ".behind_by"]).trim());
  return { ...pr, verdict, behindBy };
};

const rawPrs: any[] = ghJson([
  "pr", "list", "--repo", repo, "--state", "open", "--base", base, "--limit", "200",
  "--json", "number,title,headRefName,headRefOid,labels,autoMergeRequest,body,createdAt",
]);
const prs: PrState[] = rawPrs.map((raw) =>
  withMergeState(withLabelState(prFromGitHub(raw), ["agent:in-progress", "agent:review", "agent:implement"]), raw.createdAt),
);

/* Snapshot: runs. Completed ones within the lookback, plus everything still live. */

const lookbackMinutes = Math.max(deadlines.stuckMinutes, deadlines.verdictMinutes, deadlines.updateMinutes) + 30;
const since = new Date(now.getTime() - lookbackMinutes * 60_000).toISOString();
const runsById = new Map<number, Run>();
for (const query of [`created=%3E%3D${since}`, "status=queued", "status=in_progress", "status=waiting"]) {
  for (const raw of paginate(`repos/${repo}/actions/runs?${query}&per_page=100`, readEnv)) {
    for (const r of raw.workflow_runs ?? []) runsById.set(Number(r.id), runFromGitHub(r));
  }
}

/** Only the runs that could cover a labeled subject need their jobs read. */
const labeled = (labels: readonly string[]): boolean => labels.some((l) => l.startsWith("agent:")) && !parked(labels);
const subjects = [
  ...issues.filter((t) => labeled(t.labels)).map((t) => ({ kind: "issue" as const, title: t.title })),
  ...prs.filter((p) => labeled(p.labels)).map((p) => ({ kind: "pr" as const, headRef: p.headRef })),
];
for (const subject of subjects) {
  for (const run of runsFor(subject, [...runsById.values()])) {
    if (run.role !== undefined) continue;
    try {
      const jobs = ghJson(["api", `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, "--jq", "[.jobs[] | {name, conclusion}]"], readEnv);
      run.role = roleFromJobs(jobs);
    } catch (error) {
      console.log(`::warning::Could not read the jobs of run ${run.id}; treating it as covering while live: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const snapshot: Snapshot = { now: now.toISOString(), base, issues, prs, runs: [...runsById.values()], sweepUrl: runUrl };

/* Decide and apply. */

const decisions = reconcile(snapshot, deadlines);
console.log(
  `Sweep of ${repo} at ${snapshot.now}: ${issues.length} open issue(s), ${prs.length} open PR(s) on ${base}, ${snapshot.runs.length} run(s) in the last ${lookbackMinutes} min or live; deadlines stuck ${deadlines.stuckMinutes}, verdict ${deadlines.verdictMinutes}, update ${deadlines.updateMinutes} min.`,
);
for (const d of decisions) console.log(d.log);

const edit = (subject: Decision["subject"], args: string[]): void => {
  gh([subject.kind === "issue" ? "issue" : "pr", "edit", String(subject.number), "--repo", repo, ...args]);
};
const comment = (subject: Decision["subject"], body: string): void => {
  gh([subject.kind === "issue" ? "issue" : "pr", "comment", String(subject.number), "--repo", repo, "--body", body]);
};

const apply = (d: Decision): void => {
  const { action, subject } = d;
  switch (action.type) {
    case "none":
      return;
    case "relabel":
      for (const label of action.remove) edit(subject, ["--remove-label", label]);
      edit(subject, ["--add-label", action.add]);
      if (d.comment) comment(subject, d.comment);
      return;
    case "escalate":
      for (const label of action.remove) edit(subject, ["--remove-label", label]);
      edit(subject, ["--add-label", action.add]);
      if (d.comment) comment(subject, d.comment);
      if (action.ticket !== undefined) {
        const ticket = { kind: "issue" as const, number: action.ticket };
        edit(ticket, ["--add-label", action.add]);
        comment(ticket, `PR #${subject.number} was escalated by the reconciler: ${d.log}${runUrl ? `\n\nSweep: ${runUrl}` : ""}`);
      }
      return;
    case "dispatch":
      gh(["api", "--method", "POST", `repos/${repo}/dispatches`, "-f", `event_type=${action.eventType}`, "-F", `client_payload[pr]=${action.pr}`, "--silent"]);
      return;
  }
};

const applied: string[] = [];
const failed: { log: string; error: string }[] = [];
for (const d of decisions) {
  if (d.action.type === "none" || dryRun) continue;
  try {
    apply(d);
    applied.push(d.log);
    console.log(`Applied: ${d.log}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failed.push({ log: d.log, error: message });
    console.error(`Could not apply "${d.log}": ${message}`);
  }
}

const outputDir = process.env.OUTPUT_DIR;
if (outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "sweep.json"),
    JSON.stringify({ repo, dryRun, deadlines, snapshot, decisions, applied, failed }, null, 2),
  );
}

const repairs = decisions.filter((d) => d.action.type !== "none").length;
console.log(`${decisions.length} decision(s), ${repairs} repair(s), ${applied.length} applied, ${failed.length} failed${dryRun ? " (dry run)" : ""}.`);
if (failed.length > 0) process.exit(1);
