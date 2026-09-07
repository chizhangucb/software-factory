/**
 * Update-branch: the v0 stand-in for a merge queue (ADR 0003, fallback
 * amendment). Runs when main moves and when a factory/verdict passes.
 * Every open PR on main with auto-merge enabled and a stale head gets
 * GitHub's update-branch call with FACTORY_PAT, so the target's CI and the
 * gate re-run on the new head and auto-merge lands it on the latest main.
 * A passing factory/verdict is carried onto the merge commit GitHub made
 * (see plan.ts). A conflict the API cannot resolve is commented and labeled
 * agent:blocked; escalation proper is #16. No agent runs here.
 *
 * Env: GH_REPO (owner/repo), GH_TOKEN (FACTORY_PAT, for the update call,
 * comments, and labels), STATUS_TOKEN (GITHUB_TOKEN, for the carried
 * status: a fine-grained PAT cannot write statuses; defaults to GH_TOKEN),
 * optional BASE_BRANCH (default main), optional OUTPUT_DIR for
 * update-branch.json, optional DRY_RUN=1 to plan without writing.
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
  type HeadCommit,
  type OpenPr,
  type Plan,
  VERDICT_CONTEXT,
  carriedVerdict,
  isUpdateMerge,
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

const gh = (args: string[], env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });

const statusEnv = { ...process.env, GH_TOKEN: process.env.STATUS_TOKEN || process.env.GH_TOKEN };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type RawPr = {
  number: number;
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
      "--json", "number,headRefOid,headRefName,autoMergeRequest,mergeable,labels",
    ]),
  );

const behindBy = (headSha: string): number =>
  Number(gh(["api", `repos/${repo}/compare/${base}...${headSha}`, "--jq", ".behind_by"]).trim());

const headStatuses = (sha: string): CommitStatus[] =>
  JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/status`, "--jq", ".statuses"]));

const verdictState = (statuses: readonly CommitStatus[]): OpenPr["verdictOnHead"] =>
  statuses.find((s) => s.context === VERDICT_CONTEXT)?.state ?? "none";

const commit = (sha: string): HeadCommit => {
  const raw = JSON.parse(
    gh(["api", `repos/${repo}/commits/${sha}`, "--jq", "{sha, parents: [.parents[].sha], committerLogin: .committer.login}"]),
  );
  return { sha: raw.sha, parents: raw.parents, committerLogin: raw.committerLogin ?? null };
};

const toOpenPr = (raw: RawPr): OpenPr => {
  const autoMerge = raw.autoMergeRequest !== null && raw.autoMergeRequest !== undefined;
  const mergeable: OpenPr["mergeable"] =
    raw.mergeable === "MERGEABLE" || raw.mergeable === "CONFLICTING" ? raw.mergeable : "UNKNOWN";
  // The lookups are only worth making for PRs the plan could act on.
  const active = autoMerge && mergeable !== "CONFLICTING";
  return {
    number: raw.number,
    autoMerge,
    behindBy: active ? behindBy(raw.headRefOid) : 0,
    mergeable,
    labels: raw.labels.map((l) => l.name),
    verdictOnHead: active ? verdictState(headStatuses(raw.headRefOid)) : "none",
    head: active ? commit(raw.headRefOid) : { sha: raw.headRefOid, parents: [], committerLogin: null },
  };
};

const postStatus = (sha: string, status: CommitStatus): void => {
  gh([
    "api", "--method", "POST", `repos/${repo}/statuses/${sha}`,
    "-f", `state=${status.state}`, "-f", `context=${status.context}`,
    "-f", `description=${status.description ?? ""}`, "-f", `target_url=${status.target_url ?? runUrl}`,
    "--silent",
  ], statusEnv);
};

/** Post the first parent's passing verdict on this update merge commit; true when one was posted. */
const carryOnto = (head: HeadCommit): boolean => {
  if (!isUpdateMerge(head)) return false;
  const parent = head.parents[0]!;
  const verdict = carriedVerdict(headStatuses(parent), parent);
  if (!verdict) return false;
  postStatus(head.sha, verdict);
  return true;
};

type UpdateResult = "accepted" | "conflict" | "head moved";

/** PUT update-branch. The two documented 422s are outcomes, not failures. */
const requestUpdate = (number: number, expectedHead: string): UpdateResult => {
  try {
    gh([
      "api", "--method", "PUT", `repos/${repo}/pulls/${number}/update-branch`,
      "-f", `expected_head_sha=${expectedHead}`, "--silent",
    ]);
    return "accepted";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/422/.test(message) && /conflict/i.test(message)) return "conflict";
    if (/422/.test(message) && /expected head sha/i.test(message)) return "head moved";
    throw error;
  }
};

/** The update is asynchronous; wait for the head to move so the verdict can follow it now. */
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

type Outcome = Plan & { oldHead?: string; newHead?: string; verdictCarried?: boolean; note?: string; error?: string };

const raws = openPrs();
const prs = raws.map(toOpenPr);
const plans = planUpdates(prs);
const outcomes: Outcome[] = [];
let failed = 0;

for (const plan of plans) {
  const pr = prs.find((p) => p.number === plan.number)!;
  const raw = raws.find((r) => r.number === plan.number)!;
  const outcome: Outcome = { ...plan, oldHead: pr.head.sha };
  outcomes.push(outcome);
  console.log(`#${plan.number} (${raw.headRefName} @ ${pr.head.sha.slice(0, 7)}): ${plan.action}, ${plan.reason}`);
  if (dryRun) continue;
  try {
    if (plan.carry) {
      outcome.verdictCarried = carryOnto(pr.head);
      console.log(
        outcome.verdictCarried
          ? `#${plan.number}: ${VERDICT_CONTEXT} carried from ${pr.head.parents[0]!.slice(0, 7)} onto ${pr.head.sha.slice(0, 7)}.`
          : `#${plan.number}: no passing ${VERDICT_CONTEXT} on ${pr.head.parents[0]!.slice(0, 7)} to carry.`,
      );
    }
    if (plan.action === "skip") continue;
    if (plan.action === "escalate") {
      escalate(plan.number);
      console.log(`Escalated #${plan.number}: commented and labeled ${BLOCKED_LABEL}.`);
      continue;
    }
    const result = requestUpdate(plan.number, pr.head.sha);
    if (result === "conflict") {
      outcome.action = "escalate";
      outcome.reason = "update-branch refused: conflicts with main";
      escalate(plan.number);
      console.log(`update-branch refused #${plan.number} (conflict); commented and labeled ${BLOCKED_LABEL}.`);
      continue;
    }
    if (result === "head moved") {
      outcome.action = "skip";
      outcome.reason = "head moved since the scan; the next run will see it";
      console.log(`#${plan.number}: ${outcome.reason}.`);
      continue;
    }
    console.log(`update-branch accepted for #${plan.number}; waiting for the new head.`);
    const newHead = await waitForNewHead(plan.number, pr.head.sha);
    if (!newHead) {
      outcome.note = "head did not move within two minutes; the next run carries the verdict";
      console.log(`#${plan.number}: ${outcome.note}.`);
      continue;
    }
    outcome.newHead = newHead;
    const head = commit(newHead);
    if (head.parents[0] !== pr.head.sha || !isUpdateMerge(head)) {
      outcome.note = "new head is not GitHub's merge of the old head; verdict not carried";
      console.log(`#${plan.number}: head ${pr.head.sha.slice(0, 7)} -> ${newHead.slice(0, 7)}; ${outcome.note}.`);
      continue;
    }
    outcome.verdictCarried = carryOnto(head);
    console.log(
      `#${plan.number}: head ${pr.head.sha.slice(0, 7)} -> ${newHead.slice(0, 7)}; ` +
        (outcome.verdictCarried ? `${VERDICT_CONTEXT} carried.` : `no passing ${VERDICT_CONTEXT} to carry.`),
    );
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
const carried = outcomes.filter((o) => o.verdictCarried).length;
console.log(
  `${prs.length} open PR(s) on ${base}, ${updated} updated, ${carried} verdict(s) carried, ${escalated} escalated, ${failed} failed${dryRun ? " (dry run)" : ""}.`,
);
if (failed > 0) process.exit(1);
