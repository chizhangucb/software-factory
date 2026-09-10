/**
 * Update-branch: the v0 stand-in for a merge queue (ADR 0003, fallback
 * amendment). Runs when main moves and when a factory/verdict passes.
 * Every open PR on main with auto-merge enabled and a stale head gets
 * GitHub's update-branch call with FACTORY_PAT, so the target's CI and the
 * gate re-run on the new head and auto-merge lands it on the latest main.
 * A passing factory/verdict is carried onto the merge commit GitHub made
 * (see plan.ts); the old head gets a factory/update-branch status the moment
 * the call is accepted, so a later run can tell that merge from one a person
 * made in the web editor. A conflict the API cannot resolve is commented and
 * labeled agent:implement, so agent-implement-pr.yml resolves it on the branch
 * (planConflict in plan.ts, ADR 0003 as amended by #19). No agent runs here.
 *
 * Env: GH_REPO (owner/repo), GH_TOKEN (FACTORY_PAT, for the update call,
 * comments, and labels), STATUS_TOKEN (GITHUB_TOKEN, for reading and
 * posting statuses: a fine-grained PAT can do neither; defaults to GH_TOKEN),
 * optional BASE_BRANCH (default main), optional OUTPUT_DIR for
 * update-branch.json, optional DRY_RUN=1 to plan without writing.
 *
 * Builtins only, imported with `.ts` extensions, so the job runs on bare
 * `node --experimental-strip-types` and skips installing the engine.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { errorMessage } from "../lib/errors.ts";
import { GhError, gh } from "../lib/gh.ts";
import { IMPLEMENT_LABEL } from "../lib/labels.ts";
import {
  type CommitStatus,
  type HeadCommit,
  type OpenPr,
  type Plan,
  UPDATE_MARKER_CONTEXT,
  type UpdateRefusal,
  VERDICT_CONTEXT,
  carriedVerdict,
  findVerdict,
  isUpdateMerge,
  planConflict,
  planUpdates,
  updateRefusal,
} from "./plan.ts";

const repo = process.env.GH_REPO;
if (!repo) {
  console.error("Missing required env var: GH_REPO");
  process.exit(1);
}
const base = process.env.BASE_BRANCH || "main";
const dryRun = process.env.DRY_RUN === "1";
const runUrl = process.env.RUN_URL ?? "";

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
  JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/status`, "--jq", ".statuses"], statusEnv));

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
  const head = active ? commit(raw.headRefOid) : { sha: raw.headRefOid, parents: [], committerLogin: null };
  return {
    number: raw.number,
    autoMerge,
    behindBy: active ? behindBy(raw.headRefOid) : 0,
    mergeable,
    labels: raw.labels.map((l) => l.name),
    head,
    verdict: active ? findVerdict(head, headStatuses, commit) : { state: "none", sha: head.sha },
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

/** Post the passing verdict found on `fromSha` onto `head`; true when one was posted. */
const carryOnto = (head: HeadCommit, fromSha: string): boolean => {
  const verdict = carriedVerdict(headStatuses(fromSha), fromSha);
  if (!verdict) return false;
  postStatus(head.sha, verdict);
  return true;
};

type UpdateResult = "accepted" | UpdateRefusal;

/**
 * PUT update-branch. The two documented 422s are outcomes, not failures, and
 * which one it is comes off the failed call's own fields (`updateRefusal` in
 * plan.ts): the exit status and what gh printed on stderr. Anything else is a
 * failure and is rethrown.
 */
const requestUpdate = (number: number, expectedHead: string): UpdateResult => {
  try {
    gh([
      "api", "--method", "PUT", `repos/${repo}/pulls/${number}/update-branch`,
      "-f", `expected_head_sha=${expectedHead}`, "--silent",
    ]);
    return "accepted";
  } catch (error) {
    const refusal = error instanceof GhError ? updateRefusal(error) : undefined;
    if (refusal) return refusal;
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

/** No API call resolves a conflict: label the PR for agent-implement-pr.yml, which merges the base on the branch and resolves. */
const handOff = (number: number): void => {
  const body = [
    "update-branch could not bring this PR up to date with `" + base + "`: the merge conflicts.",
    "",
    "Handing it to the implementer: labeled `" + IMPLEMENT_LABEL + "`. Its run merges `" + base +
      "` into the branch, resolves the conflicts, and pushes; the review then judges the new head and auto-merge lands it.",
    runUrl ? `\nRun: ${runUrl}` : "",
  ].join("\n");
  gh(["pr", "comment", String(number), "--repo", repo, "--body", body]);
  gh(["pr", "edit", String(number), "--repo", repo, "--add-label", IMPLEMENT_LABEL]);
};

/** Mark the head the factory asked GitHub to update from; findVerdict trusts only merges made on such a head. */
const markRequested = (number: number, headSha: string): void => {
  postStatus(headSha, {
    context: UPDATE_MARKER_CONTEXT,
    state: "success",
    description: `update-branch requested for #${number} by the factory`,
    target_url: runUrl || null,
  });
};

type Outcome = Plan & { oldHead?: string; newHead?: string; verdictCarried?: boolean; note?: string; error?: string };

const raws = openPrs();
const outcomes: Outcome[] = [];
let failed = 0;

// Each PR's lookups (compare, commit, statuses) fail on their own; one unreadable PR must not stall the rest.
const prs: OpenPr[] = [];
for (const raw of raws) {
  try {
    prs.push(toOpenPr(raw));
  } catch (error) {
    const message = errorMessage(error);
    outcomes.push({ number: raw.number, action: "skip", carry: false, reason: "could not read the PR", oldHead: raw.headRefOid, error: message });
    console.error(`#${raw.number} (${raw.headRefName} @ ${raw.headRefOid.slice(0, 7)}): could not read the PR: ${message}`);
    failed++;
  }
}
const plans = planUpdates(prs);

for (const plan of plans) {
  const pr = prs.find((p) => p.number === plan.number)!;
  const raw = raws.find((r) => r.number === plan.number)!;
  const outcome: Outcome = { ...plan, oldHead: pr.head.sha };
  outcomes.push(outcome);
  console.log(`#${plan.number} (${raw.headRefName} @ ${pr.head.sha.slice(0, 7)}): ${plan.action}, ${plan.reason}`);
  if (dryRun) continue;
  try {
    if (plan.carry) {
      outcome.verdictCarried = carryOnto(pr.head, pr.verdict.sha);
      console.log(
        outcome.verdictCarried
          ? `#${plan.number}: ${VERDICT_CONTEXT} carried from ${pr.verdict.sha.slice(0, 7)} onto ${pr.head.sha.slice(0, 7)}.`
          : `#${plan.number}: no passing ${VERDICT_CONTEXT} on ${pr.verdict.sha.slice(0, 7)} to carry.`,
      );
    }
    if (plan.action === "skip") continue;
    if (plan.action === "hand-off") {
      handOff(plan.number);
      console.log(`Handed off #${plan.number}: commented and labeled ${IMPLEMENT_LABEL}.`);
      continue;
    }
    const result = requestUpdate(plan.number, pr.head.sha);
    if (result === "conflict") {
      // The same decision the plan takes on a CONFLICTING PR, reached here because
      // the scan read UNKNOWN and GitHub answered with the conflict (plan.ts). That
      // GitHub refused the call is this caller's own fact, so this is where it is
      // said; the decision is the same one either way.
      const conflict = planConflict(pr);
      const reason = `update-branch refused: ${conflict.reason}`;
      // Action and reason only: the plan's `carry` was already acted on above.
      outcome.action = conflict.action;
      outcome.reason = reason;
      if (conflict.action === "hand-off") {
        handOff(plan.number);
        console.log(`#${plan.number}: ${reason}; commented and labeled ${IMPLEMENT_LABEL}.`);
      } else {
        console.log(`#${plan.number}: ${reason}, left alone.`);
      }
      continue;
    }
    if (result === "head moved") {
      outcome.action = "skip";
      outcome.reason = "head moved since the scan; the next run will see it";
      console.log(`#${plan.number}: ${outcome.reason}.`);
      continue;
    }
    markRequested(plan.number, pr.head.sha);
    console.log(`update-branch accepted for #${plan.number}, ${UPDATE_MARKER_CONTEXT} posted on ${pr.head.sha.slice(0, 7)}; waiting for the new head.`);
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
    // The verdict now sits on the old head, either the reviewer's or the one carried above.
    outcome.verdictCarried = pr.verdict.state === "success" && carryOnto(head, pr.head.sha);
    console.log(
      `#${plan.number}: head ${pr.head.sha.slice(0, 7)} -> ${newHead.slice(0, 7)}; ` +
        (outcome.verdictCarried ? `${VERDICT_CONTEXT} carried.` : `no passing ${VERDICT_CONTEXT} to carry.`),
    );
  } catch (error) {
    outcome.error = errorMessage(error);
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
const handedOff = outcomes.filter((o) => o.action === "hand-off").length;
const carried = outcomes.filter((o) => o.verdictCarried).length;
console.log(
  `${prs.length} open PR(s) on ${base}, ${updated} updated, ${carried} verdict(s) carried, ${handedOff} handed to the implementer, ${failed} failed${dryRun ? " (dry run)" : ""}.`,
);
if (failed > 0) process.exit(1);
