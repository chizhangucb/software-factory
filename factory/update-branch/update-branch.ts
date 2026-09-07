/**
 * Update-branch: the v0 stand-in for a merge queue (ADR 0003, fallback
 * amendment). Runs when main moves and when a factory PR is marked ready.
 * Every open PR on main with auto-merge enabled and a stale head gets
 * GitHub's update-branch call with FACTORY_PAT, so the target's CI and the
 * gate re-run on the new head and auto-merge lands it on the latest main.
 * A passing factory/verdict is carried to the new head (see plan.ts). A
 * conflict the API cannot resolve is commented and labeled agent:blocked;
 * escalation proper is #16. No agent runs here.
 *
 * Env: GH_REPO (owner/repo), GH_TOKEN (FACTORY_PAT), optional BASE_BRANCH
 * (default main), optional OUTPUT_DIR for update-branch.json, optional
 * DRY_RUN=1 to plan without writing.
 *
 * Builtins only, imported with `.ts` extensions, so the job runs on bare
 * `node --experimental-strip-types` and skips installing the engine.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  BLOCKED_LABEL,
  type CommitStatus,
  type OpenPr,
  type Plan,
  VERDICT_CONTEXT,
  carriedVerdict,
  planUpdates,
} from "./plan.ts";

const repo = process.env.GH_REPO;
if (!repo) {
  console.error("Missing required env var: GH_REPO");
  process.exit(1);
}
const base = process.env.BASE_BRANCH || "main";
const dryRun = process.env.DRY_RUN === "1";
const runUrl = process.env.RUN_URL ?? "";

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type RawPr = {
  number: number;
  isDraft: boolean;
  headRefOid: string;
  headRefName: string;
  autoMergeRequest: unknown;
  mergeable: string;
  labels: { name: string }[];
};

const openPrs = (): RawPr[] =>
  JSON.parse(
    gh([
      "pr", "list", "--repo", repo, "--state", "open", "--base", base, "--limit", "200",
      "--json", "number,isDraft,headRefOid,headRefName,autoMergeRequest,mergeable,labels",
    ]),
  );

const behindBy = (headSha: string): number =>
  Number(gh(["api", `repos/${repo}/compare/${base}...${headSha}`, "--jq", ".behind_by"]).trim());

const toOpenPr = (raw: RawPr): OpenPr => {
  const autoMerge = raw.autoMergeRequest !== null && raw.autoMergeRequest !== undefined;
  const mergeable: OpenPr["mergeable"] =
    raw.mergeable === "MERGEABLE" || raw.mergeable === "CONFLICTING" ? raw.mergeable : "UNKNOWN";
  return {
    number: raw.number,
    isDraft: raw.isDraft,
    autoMerge,
    // The compare call is only worth making for PRs the plan could act on.
    behindBy: autoMerge && !raw.isDraft ? behindBy(raw.headRefOid) : 0,
    mergeable,
    labels: raw.labels.map((l) => l.name),
  };
};

const headStatuses = (sha: string): CommitStatus[] =>
  JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/status`, "--jq", ".statuses"]));

const postStatus = (sha: string, status: CommitStatus): void => {
  gh([
    "api", "--method", "POST", `repos/${repo}/statuses/${sha}`,
    "-f", `state=${status.state}`, "-f", `context=${status.context}`,
    "-f", `description=${status.description ?? ""}`, "-f", `target_url=${status.target_url ?? runUrl}`,
    "--silent",
  ]);
};

/** PUT update-branch; true when accepted, false on a conflict the API refuses to merge. */
const requestUpdate = (number: number, expectedHead: string): boolean => {
  try {
    gh([
      "api", "--method", "PUT", `repos/${repo}/pulls/${number}/update-branch`,
      "-f", `expected_head_sha=${expectedHead}`, "--silent",
    ]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/422/.test(message) && /conflict/i.test(message)) return false;
    throw error;
  }
};

/** The update is asynchronous; wait for the head to move so the verdict can follow it. */
const waitForNewHead = async (number: number, oldHead: string): Promise<string | undefined> => {
  for (let attempt = 0; attempt < 24; attempt++) {
    await sleep(5000);
    const head = gh(["pr", "view", String(number), "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"]).trim();
    if (head && head !== oldHead) return head;
  }
  return undefined;
};

const escalate = (number: number): void => {
  const body = [
    "update-branch could not bring this PR up to date with `" + base + "`: the merge conflicts.",
    "",
    "Auto-merge stays enabled but cannot fire until the conflict is resolved. Labeled `" + BLOCKED_LABEL + "`.",
    runUrl ? `\nRun: ${runUrl}` : "",
  ].join("\n");
  gh(["pr", "comment", String(number), "--repo", repo, "--body", body]);
  gh(["pr", "edit", String(number), "--repo", repo, "--add-label", BLOCKED_LABEL]);
};

type Outcome = Plan & { oldHead?: string; newHead?: string; verdictCarried?: boolean; error?: string };

const raws = openPrs();
const prs = raws.map(toOpenPr);
const plans = planUpdates(prs);
const outcomes: Outcome[] = [];
let failed = 0;

for (const plan of plans) {
  const raw = raws.find((r) => r.number === plan.number)!;
  const outcome: Outcome = { ...plan, oldHead: raw.headRefOid };
  outcomes.push(outcome);
  console.log(`#${plan.number} (${raw.headRefName} @ ${raw.headRefOid.slice(0, 7)}): ${plan.action}, ${plan.reason}`);
  if (dryRun || plan.action === "skip") continue;
  try {
    if (plan.action === "escalate") {
      escalate(plan.number);
      console.log(`Escalated #${plan.number}: commented and labeled ${BLOCKED_LABEL}.`);
      continue;
    }
    if (!requestUpdate(plan.number, raw.headRefOid)) {
      outcome.action = "escalate";
      outcome.reason = "update-branch refused: conflicts with main";
      escalate(plan.number);
      console.log(`update-branch refused #${plan.number} (conflict); commented and labeled ${BLOCKED_LABEL}.`);
      continue;
    }
    console.log(`update-branch accepted for #${plan.number}; waiting for the new head.`);
    const newHead = await waitForNewHead(plan.number, raw.headRefOid);
    if (!newHead) {
      outcome.error = "head did not move within two minutes; verdict not carried";
      console.error(`#${plan.number}: ${outcome.error}`);
      failed++;
      continue;
    }
    outcome.newHead = newHead;
    const verdict = carriedVerdict(headStatuses(raw.headRefOid), raw.headRefOid);
    if (verdict) {
      postStatus(newHead, verdict);
      outcome.verdictCarried = true;
      console.log(`#${plan.number}: head ${raw.headRefOid.slice(0, 7)} -> ${newHead.slice(0, 7)}; ${VERDICT_CONTEXT} carried.`);
    } else {
      outcome.verdictCarried = false;
      console.log(`#${plan.number}: head ${raw.headRefOid.slice(0, 7)} -> ${newHead.slice(0, 7)}; no passing ${VERDICT_CONTEXT} to carry.`);
    }
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : String(error);
    console.error(`#${plan.number}: ${outcome.error}`);
    failed++;
  }
}

const outputDir = process.env.OUTPUT_DIR;
if (outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "update-branch.json"),
    JSON.stringify({ repo, base, dryRun, prs, outcomes }, null, 2),
  );
}

const updated = outcomes.filter((o) => o.newHead).length;
const escalated = outcomes.filter((o) => o.action === "escalate").length;
console.log(
  `${prs.length} open PR(s) on ${base}, ${updated} updated, ${escalated} escalated, ${failed} failed${dryRun ? " (dry run)" : ""}.`,
);
if (failed > 0) process.exit(1);
