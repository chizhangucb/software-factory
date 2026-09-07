/**
 * Dispatcher: move ready tickets into the factory.
 *
 * Runs on issue closed and labeled, on a schedule as the fallback, and by
 * hand. Reads the target repo's open issues (labels, assignees, open blocker
 * count from GitHub native dependencies, sub-issue count) and its open PRs,
 * asks `select.ts` which ones to dispatch, and adds `agent:implement` to
 * each. The label must be added with FACTORY_PAT: a label added with
 * GITHUB_TOKEN does not fire `issues: labeled`, so the implementer would
 * never start.
 *
 * Env: GH_REPO (owner/repo), GH_TOKEN (FACTORY_PAT), optional OUTPUT_DIR for
 * dispatch.json, optional DRY_RUN=1 to select without labeling.
 *
 * Builtins only, imported with `.ts` extensions, so the job runs on bare
 * `node --experimental-strip-types` and skips installing the engine: the
 * schedule path runs every ten minutes and should cost seconds.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  DISPATCH_LABEL,
  type DispatchIssue,
  fromGitHub,
  issuesClosedByPrs,
  selectForDispatch,
  whyNotDispatchableNow,
  whySkipped,
} from "./select.ts";

const repo = process.env.GH_REPO;
if (!repo) {
  console.error("Missing required env var: GH_REPO");
  process.exit(1);
}
const dryRun = process.env.DRY_RUN === "1";

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const openIssues = (): unknown[] =>
  JSON.parse(
    gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/issues?state=open&per_page=100`,
    ]),
  ).flat();

const openPrs = (): { number: number; body: string | null }[] =>
  JSON.parse(
    gh(["pr", "list", "--repo", repo, "--state", "open", "--limit", "200", "--json", "number,body"]),
  );

const label = (issue: DispatchIssue): void => {
  gh(["issue", "edit", String(issue.number), "--repo", repo, "--add-label", DISPATCH_LABEL]);
};

const closedByOpenPr = issuesClosedByPrs(openPrs());
const issues = fromGitHub(openIssues(), closedByOpenPr);
const dispatched = selectForDispatch(issues);

/** Re-read the issue itself right before labeling; the listing above may be seconds stale, and so may the PR list. */
const closedByOpenPrNow = dispatched.length > 0 && !dryRun ? issuesClosedByPrs(openPrs()) : closedByOpenPr;
const recheck = (number: number): string | undefined =>
  whyNotDispatchableNow(JSON.parse(gh(["api", `repos/${repo}/issues/${number}`])), closedByOpenPrNow);

for (const issue of issues) {
  const reason = whySkipped(issue);
  console.log(`#${issue.number}: ${reason ?? "dispatch"}`);
}

const labeled: number[] = [];
const skipped: { number: number; reason: string }[] = [];
const failed: { number: number; error: string }[] = [];
for (const issue of dispatched) {
  if (dryRun) continue;
  try {
    const stale = recheck(issue.number);
    if (stale) {
      skipped.push({ number: issue.number, reason: stale });
      console.log(`#${issue.number}: not labeled, ${stale} (re-read before labeling).`);
      continue;
    }
    label(issue);
    labeled.push(issue.number);
    console.log(`Labeled #${issue.number} ${DISPATCH_LABEL}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failed.push({ number: issue.number, error: message });
    console.error(`Could not label #${issue.number}: ${message}`);
  }
}

const outputDir = process.env.OUTPUT_DIR;
if (outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "dispatch.json"),
    JSON.stringify({ repo, dryRun, issues, dispatched: dispatched.map((i) => i.number), labeled, skipped, failed }, null, 2),
  );
}

console.log(
  `${issues.length} open issue(s), ${dispatched.length} to dispatch, ${labeled.length} labeled, ${skipped.length} changed since the snapshot${dryRun ? " (dry run)" : ""}.`,
);
if (failed.length > 0) process.exit(1);
