/**
 * Runs the two factory gate checks on a PR and writes their verdicts to
 * OUTPUT_DIR/gate.json. The workflow turns that file into the
 * `factory/red-green` and `factory/test-integrity` commit statuses.
 *
 * Runs in the target checkout at the PR head with `origin/<base>` fetched.
 * The decisions live in pure modules next to this file; this script only
 * gathers inputs (diff, linked ticket body) and runs tests.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { gh, required, safeSh, sh, writeJson, writeText } from "../agent-workflows/shared/common";
import { linkedIssueNumber } from "../lib/linked-issue";
import { parseNameStatus, type ChangedFile } from "./changed-files";
import { parseRemoves } from "./removes";
import { redGreenPlan, redGreenVerdict, type RedGreenResults, type TestResult } from "./red-green";
import { checkTestIntegrity } from "./test-integrity";

const prNumber = required("PR_NUMBER");
const baseRef = required("BASE_REF");
const testCommand = process.env.TEST_COMMAND?.trim() || "node --test";
const installCommand = process.env.INSTALL_COMMAND?.trim() ?? "npm ci";

const linkedIssueBody = (): { issueNumber: string; body: string | null } => {
  const prBody = gh(["pr", "view", prNumber, "--json", "body", "--jq", ".body"]);
  const issueNumber = linkedIssueNumber(prBody);
  if (!issueNumber) return { issueNumber: "", body: null };
  const body = safeSh(`gh issue view ${issueNumber} --json body --jq .body`);
  return { issueNumber, body };
};

const run = (cwd: string, cmd: string, args: string[] = []): TestResult => {
  const proc = spawnSync("sh", ["-c", `${cmd} "$@"`, "sh", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20 * 60 * 1000,
    // the PR's own tests run here: no GitHub credentials in their reach
    env: { ...process.env, CI: "1", GH_TOKEN: "", GITHUB_TOKEN: "" },
  });
  return { exitCode: proc.status ?? 1, output: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
};

const install = (cwd: string): void => {
  if (!installCommand) return;
  const result = run(cwd, installCommand);
  if (result.exitCode !== 0) {
    console.error(result.output);
    throw new Error(`install command failed in ${cwd}: ${installCommand}`);
  }
};

/** Checks out the base tip, overlays the head's test files, runs just those. */
const runOnBase = (testFiles: readonly string[]): TestResult => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-base-"));
  sh(`git worktree add --detach "${baseDir}" "origin/${baseRef}"`);
  try {
    for (const file of testFiles) {
      fs.mkdirSync(path.join(baseDir, path.dirname(file)), { recursive: true });
      fs.copyFileSync(file, path.join(baseDir, file));
    }
    install(baseDir);
    return run(baseDir, testCommand, [...testFiles]);
  } finally {
    safeSh(`git worktree remove --force "${baseDir}"`);
  }
};

const summarize = (name: string, ok: boolean, reasons: readonly string[], detail: string): string =>
  [`### ${name}: ${ok ? "pass" : "fail"}`, detail, ...reasons.map((r) => `- ${r}`), ""].join("\n");

const main = (): void => {
  const mergeBase = sh(`git merge-base "origin/${baseRef}" HEAD`).trim();
  const files: ChangedFile[] = parseNameStatus(sh(`git diff --name-status -M "${mergeBase}" HEAD`));
  const testPaths = files.filter((f) => f.kind === "test").map((f) => f.path);
  const diff = testPaths.length
    ? sh(`git diff "${mergeBase}" HEAD -- ${testPaths.map((p) => `"${p}"`).join(" ")}`)
    : "";
  const issue = linkedIssueBody();
  const removes = issue.body === null ? null : parseRemoves(issue.body);

  const integrity = checkTestIntegrity({ files, diff, removes });

  const plan = redGreenPlan(files, removes);
  let results: RedGreenResults | undefined;
  if (plan.run) {
    const base = runOnBase(plan.testFiles);
    install(process.cwd());
    const head = run(process.cwd(), testCommand, [...plan.testFiles]);
    results = { base, head };
    writeText("red-green-base.log", base.output);
    writeText("red-green-head.log", head.output);
  }
  const redGreen = redGreenVerdict(plan, results);

  writeJson("gate.json", {
    prNumber,
    baseRef,
    mergeBase,
    issueNumber: issue.issueNumber,
    removes,
    files,
    redGreen: { ...redGreen, plan, exitCodes: results && { base: results.base.exitCode, head: results.head.exitCode } },
    testIntegrity: integrity,
  });

  const summary = [
    summarize(
      "factory/red-green",
      redGreen.ok,
      redGreen.reasons,
      results ? `${plan.reason} (base exit ${results.base.exitCode}, head exit ${results.head.exitCode})` : redGreen.ok ? plan.reason : "",
    ),
    summarize(
      "factory/test-integrity",
      integrity.ok,
      integrity.reasons,
      issue.issueNumber
        ? `ticket #${issue.issueNumber}, Removes: ${removes === null ? "no section, strict gate" : removes.join("; ") || "empty section"}`
        : "no linked ticket (`Closes #N` missing from the PR body), strict gate",
    ),
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
};

main();
