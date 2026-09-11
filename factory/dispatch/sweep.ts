/**
 * Sweep (#35): build the reconciler's snapshot from the target repo, decide
 * with `reconcile.ts`, apply the repairs, log one line per decision.
 *
 * Runs after the dispatcher on the schedule, on workflow_dispatch, and on
 * the `factory-sweep` repository_dispatch (the heartbeat, sent from outside
 * GitHub every 10 minutes; the schedule is the fallback, since it does not
 * reliably fire). Reads that a fine-grained PAT cannot make
 * (Actions runs and jobs, commit statuses) use READ_TOKEN; every write uses
 * GH_TOKEN so the labels fire their events.
 *
 * Env: GH_REPO (owner/repo), GH_TOKEN (FACTORY_PAT), READ_TOKEN
 * (GITHUB_TOKEN; defaults to GH_TOKEN), optional BASE_BRANCH (main),
 * STUCK_MINUTES, VERDICT_MINUTES, UPDATE_MINUTES (see DEFAULT_DEADLINES),
 * RUN_URL, OUTPUT_DIR for sweep.json, DRY_RUN=1 to decide without writing.
 *
 * Every list read (issues, timelines, runs, jobs) is `gh api --paginate`
 * with a `--jq` projection to the fields the reconciler maps
 * (`gh-read.ts`): a full run payload is 10 KB and a page of them
 * overflowed the spawn buffer on the fixture. A failed read aborts the
 * sweep with one `::error::` line naming the command and the cause,
 * nothing is repaired from a partial snapshot; the one exception is a
 * run's jobs, where a failure only leaves the run's role unknown (it then
 * counts as covering while live).
 *
 * Builtins only, imported with `.ts` extensions, so the job runs on bare
 * `node --experimental-strip-types` and skips installing the engine.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { errorMessage } from "../lib/errors.ts";
import { GhError, gh } from "../lib/gh.ts";
import { escalationLabels } from "../retry/escalation.ts";
import { PROJECTIONS, type Projection, STATUSES_PROJECTION, parseItems } from "./gh-read.ts";
import {
  DEFAULT_DEADLINES,
  type Deadlines,
  type Decision,
  type PrState,
  type Run,
  type Snapshot,
  type TicketState,
  type VerdictState,
  leftAlone,
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

/**
 * A read whose command answered with something other than JSON is a failure of
 * that command, so it is thrown in the same shape `gh` itself throws (`GhError`
 * in `lib/gh.ts`): the command and the cause, no stack, no token.
 */
const ghJson = (args: string[], env?: NodeJS.ProcessEnv): any => {
  const out = gh(args, env);
  try {
    return JSON.parse(out);
  } catch {
    throw new GhError(args, new Error(`printed something other than JSON: ${out.slice(0, 200)}`));
  }
};
/** All pages of `endpoint`, each projected by gh to the fields the reconciler maps, one item per line. */
const paginate = (endpoint: string, projection: Projection, env?: NodeJS.ProcessEnv): any[] => {
  const args = ["api", "--paginate", endpoint, "--jq", PROJECTIONS[projection]];
  try {
    return parseItems(gh(args, env));
  } catch (error) {
    if (error instanceof GhError) throw error;
    throw new GhError(args, error);
  }
};

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

/* Snapshot: issues and PRs with their label times and sweep marks. */

const timeline = (number: number): any[] => paginate(`repos/${repo}/issues/${number}/timeline?per_page=100`, "timeline");

const withLabelState = <T extends TicketState | PrState>(subject: T, stateLabels: readonly string[]): T => {
  const state = stateLabels.find((l) => subject.labels.includes(l));
  if (!state || leftAlone(subject.labels)) return subject;
  const events = timeline(subject.number);
  return { ...subject, stateSince: stateSinceFromTimeline(events, state), marks: marksFromTimeline(events) };
};

const readIssues = (): TicketState[] =>
  paginate(`repos/${repo}/issues?state=open&per_page=100`, "issues")
    .filter((raw: any) => !raw.pull_request)
    .map(ticketFromGitHub)
    .map((t) => withLabelState(t, ["agent:in-progress", "agent:implement"]));

const verdictOn = (sha: string): VerdictState => {
  const statuses: { context: string; state: string }[] = ghJson(["api", `repos/${repo}/commits/${sha}/status`, "--jq", STATUSES_PROJECTION], readEnv);
  const state = statuses.find((s) => s.context === "factory/verdict")?.state;
  return state === "pending" || state === "success" || state === "failure" || state === "error" ? state : "none";
};

const later = (a: string, b: string): string => (Date.parse(a) >= Date.parse(b) ? a : b);

/** When the PR's current head appeared: the later of the PR's creation and its head commit. */
const headSince = (pr: PrState, createdAt: string): string => {
  const committed = gh(["api", `repos/${repo}/commits/${pr.headSha}`, "--jq", ".commit.committer.date"]).trim();
  return later(createdAt, committed || createdAt);
};

const withMergeState = (pr: PrState, createdAt: string): PrState => {
  if (!pr.factory || pr.labels.some((l) => l.startsWith("agent:")) || leftAlone(pr.labels)) return pr;
  // No auto-merge: the reconciler re-arms it against the same deadline (#83), and no
  // verdict can change that, so the verdict is not worth a read here.
  if (!pr.autoMerge) return { ...pr, headSince: headSince(pr, createdAt) };
  const verdict = verdictOn(pr.headSha);
  if (verdict === "none") return { ...pr, verdict, headSince: headSince(pr, createdAt) };
  if (verdict !== "success") return { ...pr, verdict };
  const behindBy = Number(gh(["api", `repos/${repo}/compare/${base}...${pr.headSha}`, "--jq", ".behind_by"]).trim());
  return { ...pr, verdict, behindBy };
};

/** `gh pr list --json` is its own projection; 200 PRs with bodies fit the buffer with room. */
const readPrs = (): PrState[] => {
  const rawPrs: any[] = ghJson([
    "pr", "list", "--repo", repo, "--state", "open", "--base", base, "--limit", "200",
    "--json", "number,title,headRefName,headRefOid,labels,autoMergeRequest,body,createdAt",
  ]);
  return rawPrs.map((raw) =>
    withMergeState(withLabelState(prFromGitHub(raw), ["agent:in-progress", "agent:review", "agent:implement"]), raw.createdAt),
  );
};

/* Snapshot: runs. Completed ones within the lookback, plus everything still live. */

const lookbackMinutes = Math.max(deadlines.stuckMinutes, deadlines.verdictMinutes, deadlines.updateMinutes) + 30;
/** Only the runs that could cover a labeled subject need their jobs read. */
const labeled = (labels: readonly string[]): boolean => labels.some((l) => l.startsWith("agent:")) && !leftAlone(labels);

const readRuns = (issues: readonly TicketState[], prs: readonly PrState[]): Run[] => {
  const since = new Date(now.getTime() - lookbackMinutes * 60_000).toISOString();
  const runsById = new Map<number, Run>();
  for (const query of [`created=%3E%3D${since}`, "status=queued", "status=in_progress", "status=waiting"]) {
    for (const raw of paginate(`repos/${repo}/actions/runs?${query}&per_page=100`, "runs", readEnv)) runsById.set(Number(raw.id), runFromGitHub(raw));
  }
  const subjects = [
    ...issues.filter((t) => labeled(t.labels)).map((t) => ({ kind: "issue" as const, title: t.title })),
    ...prs.filter((p) => labeled(p.labels)).map((p) => ({ kind: "pr" as const, headRef: p.headRef })),
  ];
  for (const subject of subjects) {
    for (const run of runsFor(subject, [...runsById.values()])) {
      if (run.role !== undefined) continue;
      try {
        const jobs = paginate(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, "jobs", readEnv);
        run.role = roleFromJobs(jobs);
      } catch (error) {
        console.log(`::warning::Could not read the jobs of run ${run.id}; treating it as covering while live: ${errorMessage(error)}`);
      }
    }
  }
  return [...runsById.values()];
};

const readSnapshot = (): Snapshot => {
  const issues = readIssues();
  const prs = readPrs();
  return { now: now.toISOString(), base, issues, prs, runs: readRuns(issues, prs), sweepUrl: runUrl };
};

/* A failed read aborts the sweep: a partial snapshot would read as stranded subjects and repair them wrongly. */
let snapshot: Snapshot;
try {
  snapshot = readSnapshot();
} catch (error) {
  if (!(error instanceof GhError)) throw error;
  console.error(`::error::Sweep of ${repo} aborted before deciding anything: ${error.message}`);
  process.exit(1);
}

/* Decide and apply. */

const decisions = reconcile(snapshot, deadlines);
console.log(
  `Sweep of ${repo} at ${snapshot.now}: ${snapshot.issues.length} open issue(s), ${snapshot.prs.length} open PR(s) on ${base}, ${snapshot.runs.length} run(s) in the last ${lookbackMinutes} min or live; deadlines stuck ${deadlines.stuckMinutes}, verdict ${deadlines.verdictMinutes}, update ${deadlines.updateMinutes} min.`,
);
for (const d of decisions) console.log(d.log);

/** A subject's kind is gh's own noun for it, so it is the subcommand: `gh issue edit`, `gh pr edit`. */
const edit = (subject: Decision["subject"], args: string[]): void => {
  gh([subject.kind, "edit", String(subject.number), "--repo", repo, ...args]);
};
/** A subject's labels right now: the snapshot may be stale by the time a repair lands. */
const labelsOf = (number: number): string[] =>
  ghJson(["issue", "view", String(number), "--repo", repo, "--json", "labels", "--jq", "[.labels[].name]"]);
const comment = (subject: Decision["subject"], body: string): void => {
  gh([subject.kind, "comment", String(subject.number), "--repo", repo, "--body", body]);
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
        // Escalating the PR parks its ticket on the same label set (#50). The ticket's
        // labels are read here, not taken from the snapshot: an earlier repair in this
        // same sweep may have changed them, and the ticket may be closed and unlisted.
        const ticket = { kind: "issue" as const, number: action.ticket };
        const ticketLabels = escalationLabels(labelsOf(action.ticket));
        for (const label of ticketLabels.remove) edit(ticket, ["--remove-label", label]);
        edit(ticket, ["--add-label", ticketLabels.add]);
        comment(
          ticket,
          `PR #${subject.number} was escalated by the reconciler: ${d.log}\n\nLabels here: ${ticketLabels.remove.length > 0 ? `\`${ticketLabels.remove.join("`, `")}\` removed, ` : ""}\`${ticketLabels.add}\` added. To hand it back, remove \`${ticketLabels.add}\` and add \`ready-for-agent\` again.${runUrl ? `\n\nSweep: ${runUrl}` : ""}`,
        );
      }
      return;
    case "dispatch":
      gh(["api", "--method", "POST", `repos/${repo}/dispatches`, "-f", `event_type=${action.eventType}`, "-F", `client_payload[pr]=${action.pr}`, "--silent"]);
      return;
    case "arm-auto-merge":
      // The same call the implement workflow's non-fatal step makes, and idempotent.
      gh(["pr", "merge", String(action.pr), "--repo", repo, "--auto", "--squash"]);
      return;
  }
};

const applied: string[] = [];
const failed: { log: string; error: string }[] = [];
/** Re-arms GitHub refused: warned, not failed, but recorded so a standing refusal is visible. */
const refused: { log: string; error: string }[] = [];
for (const d of decisions) {
  if (d.action.type === "none" || dryRun) continue;
  try {
    apply(d);
    applied.push(d.log);
    console.log(`Applied: ${d.log}`);
  } catch (error) {
    const message = errorMessage(error);
    // A refused re-arm is the target's setup, not a broken sweep: GitHub refuses
    // auto-merge on a repo that allows none and on a main whose ruleset requires
    // nothing. The implement workflow's own step is non-fatal for that same reason
    // and has already commented on the PR naming the fix. So warn and carry on: one
    // unonboarded target must not turn every sweep red forever (#83).
    if (d.action.type === "arm-auto-merge") {
      // The cause is in the message, not assumed: a target that allows no auto-merge and a
      // PR already mergeable ("clean status") both refuse here, and so does a PAT that lost
      // pull_requests write. Naming onboard.sh as the fix for all three would misread the
      // last one, so the message says what GitHub said and offers onboard.sh as the usual fix.
      refused.push({ log: d.log, error: message });
      console.log(`::warning::Could not re-arm auto-merge on PR #${d.action.pr} of ${repo}: ${message}. If the target refuses auto-merge, run scripts/onboard.sh there.`);
      continue;
    }
    failed.push({ log: d.log, error: message });
    console.error(`::error::Could not apply "${d.log}": ${message}`);
  }
}

const outputDir = process.env.OUTPUT_DIR;
if (outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "sweep.json"),
    JSON.stringify({ repo, dryRun, deadlines, snapshot, decisions, applied, refused, failed }, null, 2),
  );
}

const repairs = decisions.filter((d) => d.action.type !== "none").length;
console.log(`${decisions.length} decision(s), ${repairs} repair(s), ${applied.length} applied, ${refused.length} refused, ${failed.length} failed${dryRun ? " (dry run)" : ""}.`);
if (failed.length > 0) process.exit(1);
